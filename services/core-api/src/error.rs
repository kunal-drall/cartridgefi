//! Structured HTTP error types and Axum response serialization.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{message}")]
    BadRequest { code: &'static str, message: String },
    #[error("{message}")]
    Forbidden { code: &'static str, message: String },
    #[error("{message}")]
    NotFound { code: &'static str, message: String },
    #[error("{message}")]
    Conflict { code: &'static str, message: String },
    #[error("{message}")]
    Unprocessable {
        code: &'static str,
        message: String,
        violations: Vec<String>,
    },
    #[error("{message}")]
    RateLimited { code: &'static str, message: String },
    #[error("{message}")]
    Internal { code: &'static str, message: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEnvelope {
    pub valid: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub violations: Vec<String>,
    pub error: ErrorBody,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}

impl ApiError {
    pub fn bad_request(code: &'static str, message: impl Into<String>) -> Self {
        Self::BadRequest {
            code,
            message: message.into(),
        }
    }

    pub fn forbidden(code: &'static str, message: impl Into<String>) -> Self {
        Self::Forbidden {
            code,
            message: message.into(),
        }
    }

    pub fn not_found(code: &'static str, message: impl Into<String>) -> Self {
        Self::NotFound {
            code,
            message: message.into(),
        }
    }

    pub fn conflict(code: &'static str, message: impl Into<String>) -> Self {
        Self::Conflict {
            code,
            message: message.into(),
        }
    }

    pub fn compliance(violations: Vec<String>) -> Self {
        let joined = violations.join("; ");
        Self::Unprocessable {
            code: "COMPLIANCE_REJECTED",
            message: format!("CartridgeManifest v2.0 compliance failed: {joined}"),
            violations,
        }
    }

    pub fn rate_limited(code: &'static str, message: impl Into<String>) -> Self {
        Self::RateLimited {
            code,
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal {
            code: "INTERNAL_ERROR",
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message, retryable, violations) = match self {
            ApiError::BadRequest { code, message } => {
                (StatusCode::BAD_REQUEST, code, message, false, Vec::new())
            }
            ApiError::Forbidden { code, message } => {
                (StatusCode::FORBIDDEN, code, message, false, Vec::new())
            }
            ApiError::NotFound { code, message } => {
                (StatusCode::NOT_FOUND, code, message, false, Vec::new())
            }
            ApiError::Conflict { code, message } => {
                (StatusCode::CONFLICT, code, message, false, Vec::new())
            }
            ApiError::Unprocessable {
                code,
                message,
                violations,
            } => (
                StatusCode::UNPROCESSABLE_ENTITY,
                code,
                message,
                false,
                violations,
            ),
            ApiError::RateLimited { code, message } => (
                StatusCode::TOO_MANY_REQUESTS,
                code,
                message,
                true,
                Vec::new(),
            ),
            ApiError::Internal { code, message } => (
                StatusCode::INTERNAL_SERVER_ERROR,
                code,
                message,
                true,
                Vec::new(),
            ),
        };

        let body = ErrorEnvelope {
            valid: false,
            violations,
            error: ErrorBody {
                code,
                message,
                retryable,
            },
        };
        (status, Json(body)).into_response()
    }
}
