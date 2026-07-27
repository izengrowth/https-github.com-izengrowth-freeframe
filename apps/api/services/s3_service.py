import json
import os
import re
import boto3
from botocore.exceptions import ClientError
from ..config import settings

# S3 Content-Type and Cache-Control mappings
CONTENT_TYPE_MAP = {
    ".m3u8": ("application/vnd.apple.mpegurl", "no-cache"),
    ".ts": ("video/mp2t", "max-age=31536000"),
    ".jpg": ("image/jpeg", "max-age=86400"),
    ".jpeg": ("image/jpeg", "max-age=86400"),
    ".webp": ("image/webp", "max-age=86400"),
    ".mp3": ("audio/mpeg", "max-age=86400"),
    ".json": ("application/json", "max-age=86400"),
    ".png": ("image/png", "max-age=86400"),
}

def _is_aws_s3() -> bool:
    """Check if using AWS S3 (vs MinIO/local). Controlled by S3_STORAGE env var."""
    return settings.s3_storage.lower() == "s3"

def get_s3_client():
    """
    Create S3 client. Uses endpoint_url if S3_ENDPOINT is set (covers
    Cloudflare R2, MinIO, and other S3-compatible providers). Falls back
    to real AWS S3 only when no custom endpoint is configured.
    """
    has_custom_endpoint = bool(settings.s3_endpoint and "amazonaws.com" not in settings.s3_endpoint)
    if has_custom_endpoint:
        # Cloudflare R2, MinIO, or other S3-compatible storage
        return boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name=settings.s3_region,
        )
    else:
        # Real AWS S3
        return boto3.client(
            "s3",
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name=settings.s3_region,
        )

def _has_custom_endpoint() -> bool:
    """True when using a non-AWS S3-compatible endpoint (e.g. Cloudflare R2, MinIO)."""
    return bool(settings.s3_endpoint and "amazonaws.com" not in settings.s3_endpoint)


def _get_presign_client():
    """
    Client for generating presigned URLs. Uses s3_public_endpoint if set.
    Always passes endpoint_url for R2/MinIO so presigned URLs point to the
    correct host (not the default AWS S3 endpoint).
    """
    endpoint = settings.s3_public_endpoint or (settings.s3_endpoint if _has_custom_endpoint() else None)
    kwargs = {
        "aws_access_key_id": settings.s3_access_key,
        "aws_secret_access_key": settings.s3_secret_key,
        "region_name": settings.s3_region,
    }
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    return boto3.client("s3", **kwargs)

def ensure_bucket_exists():
    """Verify S3/R2 bucket is accessible. Called on app startup.
    Failures are logged but never crash the app — upload operations
    will surface the real error when they actually run.
    """
    import logging
    logger = logging.getLogger(__name__)
    try:
        s3 = get_s3_client()
        try:
            s3.head_bucket(Bucket=settings.s3_bucket)
        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            if error_code in ("404", "NoSuchBucket"):
                # Bucket not found — try to create it
                try:
                    if not _has_custom_endpoint() and settings.s3_region != "us-east-1":
                        s3.create_bucket(
                            Bucket=settings.s3_bucket,
                            CreateBucketConfiguration={"LocationConstraint": settings.s3_region}
                        )
                    else:
                        s3.create_bucket(Bucket=settings.s3_bucket)
                    logger.info(f"Created S3 bucket: {settings.s3_bucket}")
                except ClientError as create_err:
                    logger.warning(f"Could not create bucket: {create_err}")
            elif error_code == "403":
                # 403 on R2/MinIO = bucket exists, credentials valid, no list permission
                # This is fine — uploads will still work
                logger.info(f"Bucket {settings.s3_bucket} exists (403 on head = access OK)")
            else:
                logger.warning(f"Unexpected bucket check error ({error_code}): {e}")

        # Set CORS for browser-based uploads (presigned PUT) — R2 and MinIO support this
        if _has_custom_endpoint():
            try:
                s3.put_bucket_cors(
                    Bucket=settings.s3_bucket,
                    CORSConfiguration={
                        "CORSRules": [
                            {
                                "AllowedHeaders": ["*"],
                                "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
                                "AllowedOrigins": [settings.frontend_url, "http://localhost:3000", "https://*.onrender.com"],
                                "ExposeHeaders": ["ETag", "Content-Length", "x-amz-request-id"],
                                "MaxAgeSeconds": 3600,
                            }
                        ]
                    },
                )
            except ClientError as cors_err:
                logger.warning(f"Could not set bucket CORS: {cors_err}")

    except Exception as e:
        # Never crash the app on startup due to storage issues
        logger.error(f"Storage startup check failed (uploads may not work): {e}")


def get_content_type(key: str) -> tuple[str, str]:
    """Return (content_type, cache_control) for a given S3 key."""
    import os
    ext = os.path.splitext(key)[1].lower()
    return CONTENT_TYPE_MAP.get(ext, ("application/octet-stream", "no-cache"))

def create_multipart_upload(s3_key: str, content_type: str) -> str:
    """Initiate a multipart upload and return the upload_id."""
    s3 = get_s3_client()
    response = s3.create_multipart_upload(
        Bucket=settings.s3_bucket,
        Key=s3_key,
        ContentType=content_type,
    )
    return response["UploadId"]

def presign_upload_part(s3_key: str, upload_id: str, part_number: int, expires_in: int = 3600) -> str:
    """Return a presigned URL for uploading a single part."""
    s3 = _get_presign_client()
    return s3.generate_presigned_url(
        "upload_part",
        Params={
            "Bucket": settings.s3_bucket,
            "Key": s3_key,
            "UploadId": upload_id,
            "PartNumber": part_number,
        },
        ExpiresIn=expires_in,
    )

def complete_multipart_upload(s3_key: str, upload_id: str, parts: list[dict]) -> None:
    """Complete a multipart upload. `parts` is a list of {"PartNumber": int, "ETag": str}."""
    s3 = get_s3_client()
    s3.complete_multipart_upload(
        Bucket=settings.s3_bucket,
        Key=s3_key,
        UploadId=upload_id,
        MultipartUpload={"Parts": parts},
    )

def abort_multipart_upload(s3_key: str, upload_id: str) -> None:
    """Abort a multipart upload and clean up uploaded parts."""
    s3 = get_s3_client()
    s3.abort_multipart_upload(
        Bucket=settings.s3_bucket,
        Key=s3_key,
        UploadId=upload_id,
    )

def build_download_filename(display_name: str, source: str | None) -> str:
    """Return display_name with an extension appended from `source` if missing.

    `source` is an original upload filename or an S3 key — whichever is most
    authoritative for the file's real extension. If the display name already
    ends with that extension (case-insensitive), it is returned unchanged.
    """
    if not source:
        return display_name
    ext = os.path.splitext(source)[1]
    if not ext:
        return display_name
    if display_name.lower().endswith(ext.lower()):
        return display_name
    return f"{display_name}{ext}"


def generate_presigned_get_url(s3_key: str, expires_in: int = 3600, download_filename: str | None = None) -> str:
    """Generate a presigned GET URL for an object.

    Args:
        s3_key: The S3 object key.
        expires_in: URL expiry in seconds.
        download_filename: If set, adds Content-Disposition: attachment header
                          so the browser downloads with this filename.
    """
    s3 = _get_presign_client()
    params: dict = {"Bucket": settings.s3_bucket, "Key": s3_key}
    if download_filename:
        safe_name = re.sub(r'[\x00-\x1f\x7f]', '', download_filename)
        safe_name = safe_name.replace('\\', '\\\\').replace('"', '\\"')
        params["ResponseContentDisposition"] = f'attachment; filename="{safe_name}"'
    return s3.generate_presigned_url(
        "get_object",
        Params=params,
        ExpiresIn=expires_in,
    )

def put_object(s3_key: str, body: bytes, content_type: str | None = None, cache_control: str | None = None) -> None:
    """Upload a small object directly (for processed files like thumbnails)."""
    s3 = get_s3_client()
    kwargs = {"Bucket": settings.s3_bucket, "Key": s3_key, "Body": body}
    if content_type:
        kwargs["ContentType"] = content_type
    if cache_control:
        kwargs["CacheControl"] = cache_control
    s3.put_object(**kwargs)

def delete_object(s3_key: str) -> None:
    s3 = get_s3_client()
    s3.delete_object(Bucket=settings.s3_bucket, Key=s3_key)
