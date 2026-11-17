use std::ops::{Deref, DerefMut};

use serde::{Deserialize, Serialize};

/// A thin newtype around [`serde_json::Value`].
///
/// It exists so that arbitrary JSON can cross the UniFFI boundary (where it is represented as a
/// JSON string) while still behaving like a plain `serde_json::Value` in Rust.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct JsonValue(pub serde_json::Value);

impl JsonValue {
    pub fn null() -> Self {
        Self(serde_json::Value::Null)
    }

    pub fn object() -> Self {
        Self(serde_json::Value::Object(Default::default()))
    }

    pub fn into_inner(self) -> serde_json::Value {
        self.0
    }

    pub fn parse(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json).map(Self)
    }
}

impl From<serde_json::Value> for JsonValue {
    fn from(value: serde_json::Value) -> Self {
        Self(value)
    }
}

impl From<JsonValue> for serde_json::Value {
    fn from(value: JsonValue) -> Self {
        value.0
    }
}

impl Deref for JsonValue {
    type Target = serde_json::Value;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DerefMut for JsonValue {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl std::fmt::Display for JsonValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

#[cfg(feature = "uniffi")]
uniffi::custom_type!(JsonValue, String, {
    try_lift: |val| Ok(JsonValue(serde_json::from_str::<serde_json::Value>(&val)?)),
    lower: |obj| obj.0.to_string(),
});
