#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;

mod orchestrator;
use orchestrator::ORCHESTRATOR;

#[napi]
pub fn schedule_task(task_id: i64, priority: u8, agent_id_hash: i64) -> Result<u32> {
    ORCHESTRATOR
        .schedule_task(task_id as u64, priority, agent_id_hash as u64)
        .map_err(|e| Error::from_reason(e))
}

#[napi]
pub fn route_event(event_type: u8, payload: Buffer) -> Result<i32> {
    ORCHESTRATOR
        .route_event(event_type, payload.as_ref())
        .map_err(|e| Error::from_reason(e))
}

#[napi]
pub fn spawn_agent(agent_id: String) -> Result<u32> {
    ORCHESTRATOR
        .spawn_agent(agent_id)
        .map_err(|e| Error::from_reason(e))
}

#[napi]
pub fn kill_agent(agent_id: String) -> Result<bool> {
    ORCHESTRATOR
        .kill_agent(agent_id)
        .map_err(|e| Error::from_reason(e))
}

#[napi]
pub fn get_orchestrator_metrics() -> Result<String> {
    ORCHESTRATOR
        .get_metrics()
        .map_err(|e| Error::from_reason(e))
}

#[napi]
pub fn initialize_orchestrator() -> Result<()> {
    ORCHESTRATOR
        .initialize()
        .map_err(|e| Error::from_reason(e))
}

#[napi]
pub fn shutdown_orchestrator() -> Result<()> {
    ORCHESTRATOR
        .shutdown()
        .map_err(|e| Error::from_reason(e))
}
