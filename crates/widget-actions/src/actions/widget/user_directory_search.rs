//! `org.matrix.msc3973.user_directory_search` (MSC3973), widget -> host: search the user
//! directory (`POST /_matrix/client/v3/user_directory/search`).
//!
//! Body: [`UserDirectorySearchRequest`], answered with [`UserDirectorySearchResponse`]. Requires
//! `org.matrix.msc3973.user_directory_search`.

use serde::{Deserialize, Serialize};

/// Body of `user_directory_search`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct UserDirectorySearchRequest {
    pub search_term: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

/// One user directory hit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct UserDirectoryUser {
    pub user_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

/// Response to `user_directory_search`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct UserDirectorySearchResponse {
    /// Whether more results exist than `limit` allowed.
    pub limited: bool,
    pub results: Vec<UserDirectoryUser>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        let req = WidgetRequest::UserDirectorySearch {
            request: UserDirectorySearchRequest { search_term: "ali".into(), limit: Some(5) },
        };
        let wire = req.clone().into_wire("s");
        assert_eq!(wire.action, "org.matrix.msc3973.user_directory_search");
        assert_eq!(wire.to_value()["request"], json!({"search_term": "ali", "limit": 5}));
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);

        let res =
            wire.response_to(json!({"limited": false, "results": [{"user_id": "@alice:x", "display_name": "Alice"}]}));
        assert_eq!(
            WidgetResponse::from_wire(&res).unwrap(),
            WidgetResponse::UserDirectorySearch {
                response: UserDirectorySearchResponse {
                    limited: false,
                    results: vec![UserDirectoryUser {
                        user_id: "@alice:x".into(),
                        display_name: Some("Alice".into()),
                        avatar_url: None
                    }]
                }
            }
        );
    }
}
