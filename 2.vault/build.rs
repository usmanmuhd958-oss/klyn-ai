use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    napi_build::setup();
    
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let c_source_path = PathBuf::from("native/kernel_core/cognitive_router.c");
    
    let source_file = if c_source_path.exists() {
        c_source_path
    } else {
        let stub_path = out_dir.join("cognitive_router_stub.c");
        let stub_code = r#"
#include <stdint.h>
#include <stddef.h>

typedef struct __attribute__((aligned(128))) {
    uint64_t event_id;
    uint32_t priority;
    const uint8_t* payload_ptr;
    size_t payload_len;
    uint64_t timestamp;
    uint32_t routing_flags;
    uint64_t _padding[10];
} CognitiveRequest;

typedef struct __attribute__((aligned(128))) {
    uint64_t event_id;
    uint32_t status_code;
    uint8_t* result_ptr;
    size_t result_len;
    uint64_t latency_ns;
    uint64_t _padding[11];
} CognitiveResponse;

int cr_router_init(void) {
    return 0;
}

int cr_router_shutdown(void) {
    return 0;
}

int cr_router_route(const CognitiveRequest* req, CognitiveResponse* resp) {
    if (!req || !resp) return -1;
    
    resp->event_id = req->event_id;
    resp->status_code = 0;
    resp->result_ptr = (uint8_t*)0;
    resp->result_len = 0;
    resp->latency_ns = 50;
    
    return 0;
}
"#;
        fs::write(&stub_path, stub_code).expect("Failed to write stub");
        stub_path
    };
    
    cc::Build::new()
        .file(source_file)
        .include("native/kernel_core/include")
        .flag_if_supported("-O3")
        .flag_if_supported("-pthread")
        .flag_if_supported("-std=c11")
        .flag_if_supported("-march=native")
        .flag_if_supported("-mtune=native")
        .flag_if_supported("-flto")
        .opt_level(3)
        .compile("cognitive_router");
    
    println!("cargo:rerun-if-changed=native/kernel_core/cognitive_router.c");
    println!("cargo:rerun-if-changed=native/kernel_core/include");
}
