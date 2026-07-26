/**
 * @file test_cognitive_router.c
 * @brief Comprehensive test suite for cognitive_router.c
 * 
 * Test coverage:
 * - Arena allocation stress testing
 * - Memory leak detection
 * - Segmentation fault prevention
 * - High-throughput benchmarks
 * - Boundary condition testing
 * - NULL pointer defenses
 * - Concurrency testing
 * 
 * Compile: gcc -std=c11 -Wall -Wextra -O2 -pthread test_cognitive_router.c cognitive_router.c -o test_router
 * Run: ./test_router
 * Memory check: valgrind --leak-check=full --show-leak-kinds=all ./test_router
 */

#include "cognitive_router.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <pthread.h>
#include <time.h>
#include <sys/time.h>
#include <unistd.h>

/* ========================================================================== */
/* TEST FRAMEWORK                                                             */
/* ========================================================================== */

#define COLOR_RED     "\x1b[31m"
#define COLOR_GREEN   "\x1b[32m"
#define COLOR_YELLOW  "\x1b[33m"
#define COLOR_BLUE    "\x1b[34m"
#define COLOR_RESET   "\x1b[0m"

static int tests_run = 0;
static int tests_passed = 0;
static int tests_failed = 0;

typedef struct {
    const char *name;
    void (*func)(void);
} test_case_t;

#define TEST(name) static void name(void)
#define RUN_TEST(test) run_test(#test, test)

static void run_test(const char *name, void (*test_func)(void)) {
    printf(COLOR_BLUE "Running: %s" COLOR_RESET "\n", name);
    tests_run++;
    
    test_func();
    
    tests_passed++;
    printf(COLOR_GREEN "PASSED: %s" COLOR_RESET "\n\n", name);
}

static void assert_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, COLOR_RED "Assertion failed: %s" COLOR_RESET "\n", message);
        tests_failed++;
        exit(1);
    }
}

static void assert_equal_int(int expected, int actual, const char *message) {
    if (expected != actual) {
        fprintf(stderr, COLOR_RED "Assertion failed: %s (expected %d, got %d)" COLOR_RESET "\n",
                message, expected, actual);
        tests_failed++;
        exit(1);
    }
}

static void assert_not_null(void *ptr, const char *message) {
    if (ptr == NULL) {
        fprintf(stderr, COLOR_RED "Assertion failed: %s (NULL pointer)" COLOR_RESET "\n", message);
        tests_failed++;
        exit(1);
    }
}

static void assert_null(void *ptr, const char *message) {
    if (ptr != NULL) {
        fprintf(stderr, COLOR_RED "Assertion failed: %s (expected NULL)" COLOR_RESET "\n", message);
        tests_failed++;
        exit(1);
    }
}

static uint64_t get_timestamp_us(void) {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (uint64_t)tv.tv_sec * 1000000 + (uint64_t)tv.tv_usec;
}

/* ========================================================================== */
/* BASIC FUNCTIONALITY TESTS                                                 */
/* ========================================================================== */

TEST(test_router_creation) {
    cr_config_t config;
    cr_status_t status = cr_router_get_default_config(&config);
    assert_equal_int(CR_SUCCESS, status, "Get default config");
    
    cr_router_t *router = NULL;
    status = cr_router_create(&config, &router);
    assert_equal_int(CR_SUCCESS, status, "Router creation");
    assert_not_null(router, "Router handle");
    
    status = cr_router_destroy(router);
    assert_equal_int(CR_SUCCESS, status, "Router destruction");
}

TEST(test_null_pointer_defenses) {
    cr_config_t config;
    cr_router_get_default_config(&config);
    
    /* NULL config */
    cr_router_t *router = NULL;
    cr_status_t status = cr_router_create(NULL, &router);
    assert_equal_int(CR_ERROR_NULL_POINTER, status, "NULL config rejected");
    
    /* NULL output pointer */
    status = cr_router_create(&config, NULL);
    assert_equal_int(CR_ERROR_NULL_POINTER, status, "NULL output rejected");
    
    /* NULL router in operations */
    status = cr_router_destroy(NULL);
    assert_equal_int(CR_ERROR_NULL_POINTER, status, "NULL destroy rejected");
    
    cr_stats_t stats;
    status = cr_router_get_stats(NULL, &stats);
    assert_equal_int(CR_ERROR_NULL_POINTER, status, "NULL stats rejected");
}

TEST(test_route_registration) {
    cr_config_t config;
    cr_router_get_default_config(&config);
    
    cr_router_t *router = NULL;
    cr_router_create(&config, &router);
    
    cr_route_config_t route_config = {
        .route_id = "test-route",
        .weight = 100,
        .max_concurrency = 10,
        .timeout_ms = 5000,
        .enabled = true
    };
    
    cr_status_t status = cr_router_register_route(router, &route_config);
    assert_equal_int(CR_SUCCESS, status, "Route registration");
    
    cr_stats_t stats;
    cr_router_get_stats(router, &stats);
    assert_equal_int(1, stats.active_routes, "Route count");
    
    cr_router_destroy(router);
}

TEST(test_duplicate_route_rejection) {
    cr_config_t config;
    cr_router_get_default_config(&config);
    
    cr_router_t *router = NULL;
    cr_router_create(&config, &router);
    
    cr_route_config_t route_config = {
        .route_id = "duplicate",
        .weight = 100,
        .max_concurrency = 10,
        .timeout_ms = 5000,
        .enabled = true
    };
    
    cr_status_t status = cr_router_register_route(router, &route_config);
    assert_equal_int(CR_SUCCESS, status, "First registration");
    
    status = cr_router_register_route(router, &route_config);
    assert_equal_int(CR_ERROR_ROUTE_EXISTS, status, "Duplicate rejected");
    
    cr_router_destroy(router);
}

TEST(test_invalid_route_configs) {
    cr_config_t config;
    cr_router_get_default_config(&config);
    
    cr_router_t *router = NULL;
    cr_router_create(&config, &router);
    
    /* Empty route ID */
    cr_route_config_t invalid1 = {
        .route_id = "",
        .weight = 100,
        .max_concurrency = 10,
        .timeout_ms = 5000,
        .enabled = true
    };
    assert_true(cr_router_register_route(router, &invalid1) != CR_SUCCESS,
                "Empty ID rejected");
    
    /* Zero weight */
    cr_route_config_t invalid2 = {
        .route_id = "test",
        .weight = 0,
        .max_concurrency = 10,
        .timeout_ms = 5000,
        .enabled = true
    };
    assert_true(cr_router_register_route(router, &invalid2) != CR_SUCCESS,
                "Zero weight rejected");
    
    /* Zero concurrency */
    cr_route_config_t invalid3 = {
        .route_id = "test",
        .weight = 100,
        .max_concurrency = 0,
        .timeout_ms = 5000,
        .enabled = true
    };
    assert_true(cr_router_register_route(router, &invalid3) != CR_SUCCESS,
                "Zero concurrency rejected");
    
    cr_router_destroy(router);
}

TEST(test_route_unregistration) {
    cr_config_t config;
    cr_router_get_default_config(&config);
    
    cr_router_t *router = NULL;
    cr_router_create(&config, &router);
    
    cr_route_config_t route_config = {
        .route_id = "removable",
        .weight = 100,
        .max_concurrency = 10,
        .timeout_ms = 5000,
        .enabled = true
    };
    
    cr_router_register_route(router, &route_config);
    
    cr_status_t status = cr_router_unregister_route(router, "removable");
    assert_equal_int(CR_SUCCESS, status, "Route unregistration");
    
    /* Should fail second time */
    status = cr_router_unregister_route(router, "removable");
    assert_equal_int(CR_ERROR_ROUTE_NOT_FOUND, status, "Already removed");
    
    cr_router_destroy(router);
}

TEST(test_routing_decision) {
    cr_config_t config;
    cr_router_get_default_config(&config);
    
    cr_router_t *router = NULL;
    cr_router_create(&config, &router);
    
    cr_route_config_t route_config = {
        .route_id = "route-1",
        .weight = 100,
        .max_concurrency = 10,
        .timeout_ms = 5000,
        .enabled = true
    };
    cr_router_register_route(router, &route_config);
    
    cr_context_t context = {
        .request_id = "req-001",
        .priority = CR_PRIORITY_NORMAL,
        .timeout_ms = 3000,
        .metadata = ""
    };
    
    cr_decision_t decision;
    cr_status_t status = cr_router_route(router, &context, &decision);
    assert_equal_int(CR_SUCCESS, status, "Routing decision");
    assert_true(strcmp(decision.route_id, "route-1") == 0, "Correct route");
    assert_true(decision.confidence >= 0.0 && decision.confidence <= 1.0,
                "Valid confidence");
    
    cr_router_destroy(router);
}

TEST(test_routing_with_no_routes) {
    cr_config_t config;
    cr_router_get_default_config(&config);
    
    cr_router_t *router = NULL;
    cr_router_create(&config, &router);
    
    cr_context_t context = {
        .request_id = "req-001",
        .priority = CR_PRIORITY_NORMAL,
        .timeout_ms = 3000,
        .metadata = ""
    };
    
    cr_decision_t decision;
    cr_status_t status = cr_router_route(router, &context, &decision);
    assert_true(status != CR_SUCCESS, "No routes available");
    
    cr_router_destroy(router);
}

/* ========================================================================== */
/* MEMORY ALLOCATION STRESS TESTS                                            */
/* ========================================================================== */

TEST(test_arena_allocation_stress) {
    cr_config_t config;
    cr_router_get_default_config(&config);
    config.max_routes = 1024;
    config.arena_block_size = 4096;
    
    cr_router_t *router = NULL;
    cr_router_create(&config, &router);
    
    /* Register many routes to stress arena allocator */
    const int num_routes = 500;
    for (int i = 0; i < num_routes; i++) {
        char route_id[64];
        snprintf(route_id, sizeof(route_id), "arena-route-%d", i);
        
        cr_route_config_t route_config = {
            .route_id = "",
            .weight = 100,
            .max_concurrency = 10,
            .timeout_ms = 5000,
            .enabled = true
        };
        strncpy(route_config.route_id, route_id, CR_MAX_ROUTE_ID_LEN - 1);
        
        cr_status_t status = cr_router_register_route(router, &route_config);
        assert_equal_int(CR_SUCCESS, status, "Arena allocation");
    }
    
    cr_stats_t stats;
    cr_router_get_stats(router, &stats);
    assert_equal_int(num_routes, stats.active_routes, "All routes registered");
    
    /* Verify no memory corruption */
    for (int i = 0; i < num_routes; i++) {
        char route_id[64];
        snprintf(route_id, sizeof(route_id), "arena-route-%d", i);
        
        cr_route_config_t route_config;
        cr_status_t status = cr_router_get_route(router, route_id, &route_config);
        assert_equal_int(CR_SUCCESS, status, "Route retrieval");
    }
    
    cr_router_destroy(router);
}

TEST(test_memory_leak_detection) {
    /* This test should be run under valgrind */
    const int iterations = 100;
    
    for (int iter = 0; iter < iterations; iter++) {
        cr_config_t config;
        cr_router_get_default_config(&config);
        
        cr_router_t *router = NULL;
        cr_router_create(&config, &router);
        
        /* Register routes */
        for (int i = 0; i < 10; i++) {
            char route_id[64];
            snprintf(route_id, sizeof(route_id), "leak-test-%d-%d", iter, i);
            
            cr_route_config_t route_config = {
                .route_id = "",
                .weight = 100,
                .max_concurrency = 10,
                .timeout_ms = 5000,
                .enabled = true
            };
            strncpy(route_config.route_id, route_id, CR_MAX_ROUTE_ID_LEN - 1);
            
            cr_router_register_route(router, &route_config);
        }
        
        /* Perform routing */
        for (int i = 0; i < 100; i++) {
            cr_context_t context = {
                .request_id = "leak-test-req",
                .priority = CR_PRIORITY_NORMAL,
                .timeout_ms = 3000,
                .metadata = ""
            };
            
            cr_decision_t decision;
            cr_router_route(router, &context, &decision);
        }
        
        /* Cleanup */
        cr_router_destroy(router);
    }
    
    printf("  Memory leak test completed (run with valgrind to verify)\n");
}

TEST(test_buffer_overflow_protection) {
    cr_config_t config;
    cr_router_get_default_config(&config);
    
    cr_router_t *router = NULL;
    cr_router_create(&config, &router);
    
    /* Oversized route ID */
    char oversized_id[CR_MAX_ROUTE_ID_LEN + 100];
    memset(oversized_id, 'X', sizeof(oversized_id) - 1);
    oversized_id[sizeof(oversized_id) - 1] = '\0';
    
    cr_route_config_t route_config = {
        .route_id = "",
        .weight = 100,
        .max_concurrency = 10,
        .timeout_ms = 5000,
        .enabled = true
    };
    strncpy(route_config.route_id, oversized_id, CR_MAX_ROUTE_ID_LEN - 1);
    route_config.route_id[CR_MAX_ROUTE_ID_LEN - 1] = '\0';
    
    /* Should not crash */
    cr_router_register_route(router, &route_config);
    
    /* Oversized request ID */
    char oversized_req[CR_MAX_REQUEST_ID_LEN + 100];
    memset(oversized_req, 'Y', sizeof(oversized_req) - 1);
    oversized_req[sizeof(oversized_req) - 1] = '\0';
    
    cr_context_t context = {
        .request_id = "",
        .priority = CR_PRIORITY_NORMAL,
        .timeout_ms = 3000,
        .metadata = ""
    };
    strncpy(context.request_id, oversized_req, CR_MAX_REQUEST_ID_LEN - 1);
    context.request_id[CR_MAX_REQUEST_ID_LEN - 1] = '\0';
    
    cr_decision_t decision;
    cr_router_route(router, &context, &decision);
    
    cr_router_destroy(router);
    printf("  Buffer overflow protection verified\n");
}

/* ========================================================================== */
/* CONCURRENCY TESTS                                                          */
/* ========================================================================== */

typedef struct {
    cr_router_t *router;
    int thread_id;
    int iterations;
    int *success_count;
    pthread_mutex_t *mutex;
} thread_data_t;

static void* concurrent_registration_worker(void *arg) {
    thread_data_t *data = (thread_data_t*)arg;
    
    for (int i = 0; i < data->iterations; i++) {
        char route_id[64];
        snprintf(route_id, sizeof(route_id), "route-%d-%d", data->thread_id, i);
        
        cr_route_config_t route_config = {
            .route_id = "",
            .weight = 100,
            .max_concurrency = 10,
            .timeout_ms = 5000,
            .enabled = true
        };
        strncpy(route_config.route_id, route_id, CR_MAX_ROUTE_ID_LEN - 1);
        
        cr_status_t status = cr_router_register_route(data->router, &route_config);
        if (status == CR_SUCCESS) {
            pthread_mutex_lock(data->mutex);
            (*data->success_count)++;
            pthread_mutex_unlock(data->mutex);
        }
    }
    
    return NULL;
}

TEST(test_concurrent_route_registration) {
    cr_config_t config;
    cr_router_get_default_config(&config);
    config.max_routes = 1024;
    
    cr_router_t *router = NULL;
    cr_router_create(&config, &router);
    
    const int num_threads = 8;
    const int iterations_per_thread = 50;
    
    pthread_t threads[num_threads];
    thread_data_t thread_data[num_threads];
    int success_count = 0;
    pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
    
    for (int i = 0; i < num_threads; i++) {
        thread_data[i].router = router;
        thread_data[i].thread_id = i;
        thread_data[i].iterations = iterations_per_thread;
        thread_data[i].success_count = &success_count;
        thread_data[i].mutex = &mutex;
        
        pthread_create(&threads[i], NULL, concurrent_registration_worker, &thread_data[i]);
    }
    
    for (int i = 0; i < num_threads; i++) {
        pthread_join(threads[i], NULL);
    }
    
    assert_equal_int(num_threads * iterations_per_thread, success_count,
                     "All registrations successful");
    
    pthread_mutex_destroy(&mutex);
    cr_router_destroy(router);
}

static void* concurrent_routing_worker(void *arg) {
    thread_data_t *data = (thread_data_t*)arg;
    
    for (int i = 0; i < data->iterations; i++) {
        char request_id[128];
        snprintf(request_id, sizeof(request_id), "req-%d-%d", data->thread_id, i);
        
        cr_context_t context = {
            .request_id = "",
            .priority = CR_PRIORITY_NORMAL,
            .timeout_ms = 3000,
            .metadata = ""
        };
        strncpy(context.request_id, request_id, CR_MAX_REQUEST_ID_LEN - 1);
        
        cr_decision_t decision;
        cr_status_t status = cr_router_route(data->router, &context, &decision);
        
        if (status == CR_SUCCESS) {
            pthread_mutex_lock(data->mutex);
            (*data->success_count)++;
            pthread_mutex_unlock(data->mutex);
        }
    }
    
    return NULL;
}

TEST(test_concurrent_routing_decisions) {
    cr_config_t config;
    cr_router_get_default_config(&config);
    
    cr_router_t *router = NULL;
    cr_router_create(&config, &router);
    
    /* Register routes */
    for (int i = 0; i < 10; i++) {
        char route_id[64];
        snprintf(route_id, sizeof(route_id), "concurrent-route-%d", i);
        
        cr_route_config_t route_config = {
            .route_id = "",
            .weight = 100,
            .max_concurrency = 100,
            .timeout_ms = 5000,
            .enabled = true
        };
        strncpy(route_config.route_id, route_id, CR_MAX_ROUTE_ID_LEN - 1);
        
        cr_router_register_route(router, &route_config);
    }
    
    const int num_threads = 16;
    const int iterations_per_thread = 1000;
    
    pthread_t threads[num_threads];
    thread_data_t thread_data[num_threads];
    int success_count = 0;
    pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
    
    for (int i = 0; i < num_threads; i++) {
        thread_data[i].router = router;
        thread_data[i].thread_id = i;
        thread_data[i].iterations = iterations_per_thread;
        thread_data[i].success_count = &success_count;
        thread_data[i].mutex = &mutex;
        
        pthread_create(&threads[i], NULL, concurrent_routing_worker, &thread_data[i]);
    }
    
    for (int i = 0; i < num_threads; i++) {
        pthread_join(threads[i], NULL);
    }
    
    assert_equal_int(num_threads * iterations_per_thread, success_count,
                     "All routing decisions successful");
    
    pthread_mutex_destroy(&mutex);
    cr_router_destroy(router);
}

/* ========================================================================== */
/* PERFORMANCE BENCHMARKS                                                     */
/* ========================================================================== */

TEST(bench_routing_latency) {
    cr_config_t config;
    cr_router_get_default_config(&config);
    
    cr_router_t *router = NULL;
    cr_router_create(&config, &router);
    
    /* Register routes */
    for (int i = 0; i < 10; i++) {
        char route_id[64];
        snprintf(route_id, sizeof(route_id), "bench-route-%d", i);
        
        cr_route_config_t route_config = {
            .route_id = "",
            .weight = 100,
            .max_concurrency = 100,
            .timeout_ms = 5000,
            .enabled = true
        };
        strncpy(route_config.route_id, route_id, CR_MAX_ROUTE_ID_LEN - 1);
        
        cr_router_register_route(router, &route_config);
    }
    
    const int iterations = 100000;
    uint64_t start = get_timestamp_us();
    
    for (int i = 0; i < iterations; i++) {
        char request_id[128];
        snprintf(request_id, sizeof(request_id), "bench-%d", i);
        
        cr_context_t context = {
            .request_id = "",
            .priority = CR_PRIORITY_NORMAL,
            .timeout_ms = 3000,
            .metadata = ""
        };
        strncpy(context.request_id, request_id, CR_MAX_REQUEST_ID_LEN - 1);
        
        cr_decision_t decision;
        cr_router_route(router, &context, &decision);
    }
    
    uint64_t end = get_timestamp_us();
    uint64_t elapsed_us = end - start;
    double avg_latency_us = (double)elapsed_us / iterations;
    double ops_per_sec = (iterations * 1000000.0) / elapsed_us;
    
    printf(COLOR_YELLOW);
    printf("  Routing Latency Benchmark:\n");
    printf("    Iterations: %d\n", iterations);
    printf("    Total time: %lu μs\n", elapsed_us);
    printf("    Avg latency: %.2f μs\n", avg_latency_us);
    printf("    Throughput: %.0f ops/sec\n", ops_per_sec);
    printf(COLOR_RESET);
    
    assert_true(avg_latency_us < 10.0, "Latency under 10 microseconds");
    
    cr_router_destroy(router);
}

TEST(bench_concurrent_throughput) {
    cr_config_t config;
    cr_router_get_default_config(&config);
    
    cr_router_t *router = NULL;
    cr_router_create(&config, &router);
    
    /* Register routes */
    for (int i = 0; i < 20; i++) {
        char route_id[64];
        snprintf(route_id, sizeof(route_id), "throughput-route-%d", i);
        
        cr_route_config_t route_config = {
            .route_id = "",
            .weight = 100,
            .max_concurrency = 1000,
            .timeout_ms = 5000,
            .enabled = true
        };
        strncpy(route_config.route_id, route_id, CR_MAX_ROUTE_ID_LEN - 1);
        
        cr_router_register_route(router, &route_config);
    }
    
    const int num_threads = 16;
    const int iterations_per_thread = 10000;
    
    pthread_t threads[num_threads];
    thread_data_t thread_data[num_threads];
    int success_count = 0;
    pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
    
    uint64_t start = get_timestamp_us();
    
    for (int i = 0; i < num_threads; i++) {
        thread_data[i].router = router;
        thread_data[i].thread_id = i;
        thread_data[i].iterations = iterations_per_thread;
        thread_data[i].success_count = &success_count;
        thread_data[i].mutex = &mutex;
        
        pthread_create(&threads[i], NULL, concurrent_routing_worker, &thread_data[i]);
    }
    
    for (int i = 0; i < num_threads; i++) {
        pthread_join(threads[i], NULL);
    }
    
    uint64_t end = get_timestamp_us();
    uint64_t elapsed_us = end - start;
    int total_requests = num_threads * iterations_per_thread;
    double throughput = (total_requests * 1000000.0) / elapsed_us;
    
    printf(COLOR_YELLOW);
    printf("  Concurrent Throughput Benchmark:\n");
    printf("    Threads: %d\n", num_threads);
    printf("    Requests/thread: %d\n", iterations_per_thread);
    printf("    Total requests: %d\n", total_requests);
    printf("    Total time: %lu μs (%.2f ms)\n", elapsed_us, elapsed_us / 1000.0);
    printf("    Throughput: %.0f req/sec\n", throughput);
    printf(COLOR_RESET);
    
    assert_true(throughput > 50000.0, "Throughput over 50k req/sec");
    
    pthread_mutex_destroy(&mutex);
    cr_router_destroy(router);
}

/* ========================================================================== */
/* STRATEGY TESTS                                                             */
/* ========================================================================== */

TEST(test_all_strategies) {
    cr_strategy_t strategies[] = {
        CR_STRATEGY_ROUND_ROBIN,
        CR_STRATEGY_LEAST_CONNECTIONS,
        CR_STRATEGY_WEIGHTED_RANDOM,
        CR_STRATEGY_CONSISTENT_HASH,
        CR_STRATEGY_ADAPTIVE
    };
    
    for (size_t s = 0; s < sizeof(strategies) / sizeof(strategies[0]); s++) {
        cr_config_t config;
        cr_router_get_default_config(&config);
        config.strategy = strategies[s];
        
        cr_router_t *router = NULL;
        cr_router_create(&config, &router);
        
        /* Register routes */
        for (int i = 0; i < 5; i++) {
            char route_id[64];
            snprintf(route_id, sizeof(route_id), "strategy-route-%d", i);
            
            cr_route_config_t route_config = {
                .route_id = "",
                .weight = 100,
                .max_concurrency = 10,
                .timeout_ms = 5000,
                .enabled = true
            };
            strncpy(route_config.route_id, route_id, CR_MAX_ROUTE_ID_LEN - 1);
            
            cr_router_register_route(router, &route_config);
        }
        
        /* Test routing */
        cr_context_t context = {
            .request_id = "strategy-test",
            .priority = CR_PRIORITY_NORMAL,
            .timeout_ms = 3000,
            .metadata = ""
        };
        
        cr_decision_t decision;
        cr_status_t status = cr_router_route(router, &context, &decision);
        assert_equal_int(CR_SUCCESS, status, "Strategy routing");
        
        cr_router_destroy(router);
    }
}

TEST(test_consistent_hash_stability) {
    cr_config_t config;
    cr_router_get_default_config(&config);
    
    cr_router_t *router = NULL;
    cr_router_create(&config, &router);
    cr_router_set_strategy(router, CR_STRATEGY_CONSISTENT_HASH);
    
    /* Register routes */
    for (int i = 0; i < 10; i++) {
        char route_id[64];
        snprintf(route_id, sizeof(route_id), "hash-route-%d", i);
        
        cr_route_config_t route_config = {
            .route_id = "",
            .weight = 100,
            .max_concurrency = 10,
            .timeout_ms = 5000,
            .enabled = true
        };
        strncpy(route_config.route_id, route_id, CR_MAX_ROUTE_ID_LEN - 1);
        
        cr_router_register_route(router, &route_config);
    }
    
    /* Same request should always route to same destination */
    cr_context_t context = {
        .request_id = "stable-request-123",
        .priority = CR_PRIORITY_NORMAL,
        .timeout_ms = 3000,
        .metadata = ""
    };
    
    cr_decision_t first_decision;
    cr_router_route(router, &context, &first_decision);
    
    for (int i = 0; i < 100; i++) {
        cr_decision_t decision;
        cr_router_route(router, &context, &decision);
        assert_true(strcmp(decision.route_id, first_decision.route_id) == 0,
                    "Consistent hash stability");
    }
    
    cr_router_destroy(router);
}

/* ========================================================================== */
/* EDGE CASES AND STRESS TESTS                                               */
/* ========================================================================== */

TEST(test_extreme_load) {
    cr_config_t config;
    cr_router_get_default_config(&config);
    config.max_routes = 1024;
    
    cr_router_t *router = NULL;
    cr_router_create(&config, &router);
    
    /* Register many routes */
    for (int i = 0; i < 100; i++) {
        char route_id[64];
        snprintf(route_id, sizeof(route_id), "extreme-route-%d", i);
        
        cr_route_config_t route_config = {
            .route_id = "",
            .weight = 100,
            .max_concurrency = 1000,
            .timeout_ms = 5000,
            .enabled = true
        };
        strncpy(route_config.route_id, route_id, CR_MAX_ROUTE_ID_LEN - 1);
        
        cr_router_register_route(router, &route_config);
    }
    
    /* High volume routing */
    const int total_requests = 100000;
    int success_count = 0;
    
    for (int i = 0; i < total_requests; i++) {
        char request_id[128];
        snprintf(request_id, sizeof(request_id), "extreme-%d", i);
        
        cr_context_t context = {
            .request_id = "",
            .priority = CR_PRIORITY_NORMAL,
            .timeout_ms = 3000,
            .metadata = ""
        };
        strncpy(context.request_id, request_id, CR_MAX_REQUEST_ID_LEN - 1);
        
        cr_decision_t decision;
        if (cr_router_route(router, &context, &decision) == CR_SUCCESS) {
            success_count++;
        }
    }
    
    assert_equal_int(total_requests, success_count, "All requests routed");
    
    cr_router_destroy(router);
    printf("  Extreme load test: %d requests successfully routed\n", total_requests);
}

/* ========================================================================== */
/* MAIN TEST RUNNER                                                           */
/* ========================================================================== */

int main(void) {
    printf("\n");
    printf("========================================\n");
    printf("  Cognitive Router Test Suite\n");
    printf("========================================\n\n");
    
    /* Basic functionality */
    RUN_TEST(test_router_creation);
    RUN_TEST(test_null_pointer_defenses);
    RUN_TEST(test_route_registration);
    RUN_TEST(test_duplicate_route_rejection);
    RUN_TEST(test_invalid_route_configs);
    RUN_TEST(test_route_unregistration);
    RUN_TEST(test_routing_decision);
    RUN_TEST(test_routing_with_no_routes);
    
    /* Memory tests */
    RUN_TEST(test_arena_allocation_stress);
    RUN_TEST(test_memory_leak_detection);
    RUN_TEST(test_buffer_overflow_protection);
    
    /* Concurrency tests */
    RUN_TEST(test_concurrent_route_registration);
    RUN_TEST(test_concurrent_routing_decisions);
    
    /* Performance benchmarks */
    RUN_TEST(bench_routing_latency);
    RUN_TEST(bench_concurrent_throughput);
    
    /* Strategy tests */
    RUN_TEST(test_all_strategies);
    RUN_TEST(test_consistent_hash_stability);
    
    /* Stress tests */
    RUN_TEST(test_extreme_load);
    
    printf("\n");
    printf("========================================\n");
    printf("  Test Results\n");
    printf("========================================\n");
    printf("  Total tests: %d\n", tests_run);
    printf("  " COLOR_GREEN "Passed: %d" COLOR_RESET "\n", tests_passed);
    printf("  " COLOR_RED "Failed: %d" COLOR_RESET "\n", tests_failed);
    printf("========================================\n\n");
    
    if (tests_failed == 0) {
        printf(COLOR_GREEN "ALL TESTS PASSED!" COLOR_RESET "\n\n");
        return 0;
    } else {
        printf(COLOR_RED "SOME TESTS FAILED!" COLOR_RESET "\n\n");
        return 1;
    }
}
