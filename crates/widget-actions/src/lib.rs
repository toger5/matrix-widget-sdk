//! Types for the Matrix widget API as proposed in
//! [MSC4411](https://github.com/matrix-org/matrix-spec-proposals/pull/4411) (the `m.widget`
//! state event) and [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412)
//! (the JSON request/response "action" protocol spoken over `postMessage`).
//!
//! This crate is deliberately free of any I/O or state. It only knows how to:
//!
//! * (de)serialize the generic wire envelope ([`WireMessage`]),
//! * map an envelope to a typed action ([`Action`] and its leaves [`WidgetRequest`],
//!   [`WidgetResponse`], [`HostRequest`], [`HostResponse`]); each action has its own module under
//!   [`actions`], grouped by the source that initiates it,
//! * parse and match capability strings ([`Capability`]).
//!
//! Everything is plain data so it can be shared with other languages through UniFFI
//! (enable the `uniffi` feature) and compiled to WebAssembly.

// `ActionError` carries a full `WidgetError` (message plus Matrix error details); every parse
// result would have to box it to satisfy this lint, for no gain on the hot path (there is none).
#![allow(clippy::result_large_err)]

pub mod actions;
mod capabilities;
mod error;
mod file;
mod json;
mod matrix;
mod wire;

pub use actions::host::language_change::LanguageChangeRequest;
pub use actions::host::notify_capabilities::NotifyCapabilitiesRequest;
pub use actions::host::openid_credentials::OpenIdCredentialsRequest;
pub use actions::host::update_state::UpdateStateRequest;
pub use actions::host::visibility::VisibilityRequest;
pub use actions::host::{HostRequest, HostResponse};
pub use actions::widget::client_context::ClientContextResponse;
pub use actions::widget::download_file::{DownloadFileRequest, DownloadFileResponse};
pub use actions::widget::get_media_config::MediaConfigResponse;
pub use actions::widget::get_openid::{GetOpenIdResponse, OpenIdState};
pub use actions::widget::get_rtc_transports::RtcTransportsResponse;
pub use actions::widget::matrix_context::MatrixContextResponse;
pub use actions::widget::navigate::NavigateRequest;
pub use actions::widget::read_events::{ReadEventsRequest, ReadEventsResponse, RoomSelector};
pub use actions::widget::read_relations::{ReadRelationsRequest, ReadRelationsResponse, RelationDirection};
pub use actions::widget::read_room_account_data::{ReadRoomAccountDataRequest, ReadRoomAccountDataResponse};
pub use actions::widget::request_capabilities::RequestCapabilitiesRequest;
pub use actions::widget::rtc_livekit::{
    RtcLivekitDelegateDelayedLeaveRequest, RtcLivekitGetTokenRequest, RtcLivekitGetTokenResponse,
};
pub use actions::widget::send_event::{SendEventRequest, SendEventResponse};
pub use actions::widget::send_to_device::SendToDeviceRequest;
pub use actions::widget::set_always_on_screen::{SetAlwaysOnScreenRequest, SetAlwaysOnScreenResponse};
pub use actions::widget::update_delayed_event::{UpdateDelayedEventAction, UpdateDelayedEventRequest};
pub use actions::widget::upload_file::{UploadFileRequest, UploadFileResponse};
pub use actions::widget::user_directory_search::{
    UserDirectorySearchRequest, UserDirectorySearchResponse, UserDirectoryUser,
};
pub use actions::widget::{WidgetRequest, WidgetResponse};
pub use actions::Action;
pub use capabilities::{Capability, CapabilitySet};
pub use error::ActionError;
pub use file::Base64File;
pub use json::JsonValue;
pub use matrix::{
    matrix_event_from_json, matrix_event_to_json, MatrixEvent, OpenIdToken, RoomAccountData, StateKeySelector,
    ToDeviceEvent, TurnServer,
};
pub use wire::{MatrixApiError, MatrixErrorResponse, MessageKind, Source, WidgetError, WireMessage, API_VERSION_V1};

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
