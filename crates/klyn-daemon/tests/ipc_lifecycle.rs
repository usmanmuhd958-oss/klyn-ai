use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    sync::Arc,
    thread,
    time::Duration,
};

use klyn_daemon::{
    lifecycle::{Lifecycle, LifecycleState},
    policy::{Permission, UidPolicy},
    server::serve_connection,
    Router,
};
use klyn_protocol::{Method, Request, Response, PROTOCOL_VERSION};
use nix::unistd::getuid;
use serde_json::json;

#[test]
fn unix_socket_request_is_authenticated_and_uses_the_shared_protocol() {
    let lifecycle = Lifecycle::new();
    lifecycle.mark_ready().unwrap();

    let mut policy = UidPolicy::new();
    policy.grant(getuid().as_raw(), Permission::ObserveDaemon);
    let router = Arc::new(Router::new(lifecycle.clone(), Arc::new(policy)));

    let (mut client, server) = UnixStream::pair().unwrap();
    let worker_router = Arc::clone(&router);
    let worker = thread::spawn(move || serve_connection(server, &worker_router).unwrap());

    let request = Request {
        protocol_version: PROTOCOL_VERSION,
        request_id: 42,
        method: Method::Ping,
        params: json!({}),
    };
    let mut encoded = serde_json::to_vec(&request).unwrap();
    encoded.push(b'\n');
    client.write_all(&encoded).unwrap();

    let mut line = String::new();
    BufReader::new(client).read_line(&mut line).unwrap();
    let response: Response = serde_json::from_str(line.trim_end()).unwrap();

    assert_eq!(response.request_id, Some(42));
    assert_eq!(response.result.unwrap()["pong"], true);
    worker.join().unwrap();
    assert_eq!(lifecycle.snapshot().unwrap().in_flight_requests, 0);
    assert_eq!(lifecycle.snapshot().unwrap().active_connections, 0);
}

#[test]
fn unauthorized_requests_are_rejected_without_entering_the_handler() {
    let lifecycle = Lifecycle::new();
    lifecycle.mark_ready().unwrap();
    let router = Router::new(lifecycle.clone(), Arc::new(UidPolicy::new()));

    let response = router.dispatch(
        Request {
            protocol_version: PROTOCOL_VERSION,
            request_id: 8,
            method: Method::DaemonStatus,
            params: json!({}),
        },
        klyn_daemon::policy::PeerIdentity { pid: 123, uid: 9876, gid: 9876 },
    );

    assert_eq!(
        response.error.unwrap().code,
        klyn_protocol::RpcErrorCode::Unauthorized
    );
    assert_eq!(lifecycle.snapshot().unwrap().in_flight_requests, 0);
}

#[test]
fn shutdown_acknowledgement_is_sent_before_stopped_state() {
    let lifecycle = Lifecycle::new();
    lifecycle.mark_ready().unwrap();
    let mut policy = UidPolicy::new();
    policy.grant(getuid().as_raw(), Permission::ShutdownDaemon);
    let router = Arc::new(Router::new(lifecycle.clone(), Arc::new(policy)));

    let (mut client, server) = UnixStream::pair().unwrap();
    let worker_router = Arc::clone(&router);
    let worker = thread::spawn(move || serve_connection(server, &worker_router).unwrap());

    let request = Request {
        protocol_version: PROTOCOL_VERSION,
        request_id: 9,
        method: Method::DaemonShutdown,
        params: json!({}),
    };
    let mut encoded = serde_json::to_vec(&request).unwrap();
    encoded.push(b'\n');
    client.write_all(&encoded).unwrap();

    let mut line = String::new();
    BufReader::new(client).read_line(&mut line).unwrap();
    let response: Response = serde_json::from_str(line.trim_end()).unwrap();
    assert_eq!(response.result.unwrap()["state"], "draining");

    worker.join().unwrap();
    lifecycle.complete_shutdown(Duration::from_millis(50)).unwrap();
    assert_eq!(lifecycle.snapshot().unwrap().state, LifecycleState::Stopped);
}
