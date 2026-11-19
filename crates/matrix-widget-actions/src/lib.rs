//! Types for the Matrix widget API as proposed in
//! [MSC4411](https://github.com/matrix-org/matrix-spec-proposals/pull/4411) (the `m.widget`
//! state event) and [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412)
//! (the JSON request/response "action" protocol spoken over `postMessage`).
//!
//! No I/O, no state. It can:
//!
//! * (de)serialize the generic wire envelope ([`WireMessage`]),
//! * map an envelope to a typed action ([`Action`] and its leaves [`WidgetRequest`],
//!   [`WidgetResponse`], [`HostRequest`], [`HostResponse`]); each action has its own module under
//!   [`actions`], grouped by the source that initiates it,
//! * parse and match capability strings ([`Capability`]).
//!
//! Everything is plain data, exported through UniFFI (feature `uniffi`) and compiled to wasm.

// `ActionError` carries a full `WidgetError`; boxing it in every parse result gains nothing.
#![allow(clippy::result_large_err)]

pub mod actions;
mod capabilities;
mod error;
mod file;
mod json;
mod matrix;
mod wire;

pub use actions::host::notify_timeline_update::{NotifyTimelineUpdateRequest, TimelinePagination};
pub use actions::host::update_capabilities::UpdateCapabilitiesRequest;
pub use actions::host::update_language::UpdateLanguageRequest;
pub use actions::host::update_state::UpdateStateRequest;
pub use actions::host::update_visibility::UpdateVisibilityRequest;
pub use actions::host::{HostRequest, HostResponse};
pub use actions::widget::download_file::{DownloadFileRequest, DownloadFileResponse};
pub use actions::widget::get_client_context::GetClientContextResponse;
pub use actions::widget::get_matrix_context::GetMatrixContextResponse;
pub use actions::widget::get_media_config::MediaConfigResponse;
pub use actions::widget::get_rtc_transports::RtcTransportsResponse;
pub use actions::widget::navigate::NavigateRequest;
pub use actions::widget::paginate_timeline::{PaginateTimelineRequest, PaginateTimelineResponse};
pub use actions::widget::read_relations::{ReadRelationsRequest, ReadRelationsResponse, RelationDirection};
pub use actions::widget::read_room_account_data::{
    ReadRoomAccountDataRequest, ReadRoomAccountDataResponse, RoomSelector,
};
pub use actions::widget::read_timeline::{ReadTimelineRequest, ReadTimelineResponse};
pub use actions::widget::request_capabilities::RequestCapabilitiesRequest;
pub use actions::widget::rtc_livekit::{
    DelegateRtcLivekitDelayedLeaveRequest, GetRtcLivekitTokenRequest, GetRtcLivekitTokenResponse,
};
pub use actions::widget::search_user_directory::{
    SearchUserDirectoryRequest, SearchUserDirectoryResponse, UserDirectoryUser,
};
pub use actions::widget::send_event::{SendEventRequest, SendEventResponse};
pub use actions::widget::send_to_device::SendToDeviceRequest;
pub use actions::widget::set_always_on_screen::{SetAlwaysOnScreenRequest, SetAlwaysOnScreenResponse};
pub use actions::widget::update_delayed_event::{UpdateDelayedEventAction, UpdateDelayedEventRequest};
pub use actions::widget::upload_file::{UploadFileRequest, UploadFileResponse};
pub use actions::widget::{WidgetRequest, WidgetResponse};
pub use actions::Action;
pub use capabilities::{capability_is_known, is_webview_value, Capability, CapabilitySet};
pub use error::ActionError;
pub use file::Base64File;
pub use json::JsonValue;
pub use matrix::{
    matrix_event_from_json, matrix_event_to_json, MatrixEvent, OpenIdToken, PaginationStatus, RoomAccountData,
    TimelineFilter, ToDeviceEvent, TurnServer,
};
pub use wire::{
    ErrorKind, MatrixApiError, MatrixErrorResponse, MessageKind, Source, WidgetError, WireMessage, ACTION_TIMEOUT_MS,
    MSC4412_NAMESPACE, NOTIFY_READY_TIMEOUT_MS, PLACEHOLDER_NAMESPACE, STABLE_NAMESPACE,
};

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
