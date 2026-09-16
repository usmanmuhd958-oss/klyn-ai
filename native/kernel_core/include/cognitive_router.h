/**
 * @file cognitive_router.h
 * @brief KLYN AI OS Kernel Core - Cognitive Router Engine Header
 */

#ifndef KLYN_COGNITIVE_ROUTER_H
#define KLYN_COGNITIVE_ROUTER_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>

/* ========================================================================== */
/* CONSTANTS & DEFINITIONS                                                    */
/* ========================================================================== */

#define CR_MAX_ROUTE_ID_LEN   64
#define CR_MAX_REQUEST_ID_LEN 128
#define CR_METADATA_CAPACITY  256
#define CR_CACHE_LINE_SIZE    64

#define KLYN_CACHE_LINE_SIZE  CR_CACHE_LINE_SIZE

/* Static Assertion Macro */
#define KLYN_STATIC_ASSERT(cond, msg) _Static_assert(cond, msg)

/* ========================================================================== */
/* ENUMS & STATUS CODES                                                      */
/* ========================================================================== */

typedef enum {
    CR_SUCCESS                 =  0,
    CR_ERROR_NULL_POINTER      = -1,
    CR_ERROR_ROUTE_EXISTS      = -2,
    CR_ERROR_ROUTE_NOT_FOUND   = -3,
    CR_ERROR_INVALID_PARAM     = -4,
    CR_ERROR_CAPACITY_EXCEEDED = -5,
    CR_ERROR_NO_ACTIVE_ROUTES  = -6
} cr_status_t;

typedef cr_status_t klyn_status_t;

typedef enum {
    CR_PRIORITY_LOW      = 0,
    CR_PRIORITY_NORMAL   = 1,
    CR_PRIORITY_HIGH     = 2,
    CR_PRIORITY_CRITICAL = 3
} cr_priority_t;

typedef enum {
    CR_STRATEGY_ROUND_ROBIN = 0,
    CR_STRATEGY_LEAST_CONNECTIONS,
    CR_STRATEGY_WEIGHTED_RANDOM,
    CR_STRATEGY_CONSISTENT_HASH,
    CR_STRATEGY_ADAPTIVE
} cr_strategy_t;

/* ========================================================================== */
/* DATA STRUCTURES                                                            */
/* ========================================================================== */

typedef struct {
    size_t max_routes;
    size_t arena_block_size;
    cr_strategy_t strategy;
} cr_config_t;

typedef cr_config_t klyn_config_t;

typedef struct __attribute__((aligned(128))) {
    char route_id[CR_MAX_ROUTE_ID_LEN]; /* 64 bytes */
    uint32_t weight;                    /* 4 bytes */
    uint32_t max_concurrency;           /* 4 bytes */
    uint32_t timeout_ms;                /* 4 bytes */
    bool enabled;                       /* 1 byte */
    char _pad[51];                      /* 51 bytes padding = 128 bytes total */
} cr_route_config_t;

typedef cr_route_config_t klyn_route_config_t;

_Static_assert(sizeof(cr_route_config_t) == 128, "Route config must be exactly 128 bytes");

typedef struct {
    char request_id[CR_MAX_REQUEST_ID_LEN];
    cr_priority_t priority;
    uint32_t timeout_ms;
    char metadata[CR_METADATA_CAPACITY];
} cr_context_t;

typedef struct {
    char route_id[CR_MAX_ROUTE_ID_LEN];
    double confidence;
} cr_decision_t;

typedef struct {
    size_t active_routes;
    uint64_t total_routed;
} cr_stats_t;

typedef struct cr_router cr_router_t;
typedef cr_router_t klyn_router_t;

/* ========================================================================== */
/* PUBLIC API FUNCTION DECLARATIONS                                          */
/* ========================================================================== */

cr_status_t cr_router_get_default_config(cr_config_t *config);
cr_status_t cr_router_create(const cr_config_t *config, cr_router_t **router);
cr_status_t cr_router_destroy(cr_router_t *router);

cr_status_t cr_router_register_route(cr_router_t *router, const cr_route_config_t *route_config);
cr_status_t cr_router_unregister_route(cr_router_t *router, const char *route_id);
cr_status_t cr_router_get_route(const cr_router_t *router, const char *route_id, cr_route_config_t *route_config);

cr_status_t cr_router_route(cr_router_t *router, const cr_context_t *context, cr_decision_t *decision);
cr_status_t cr_router_set_strategy(cr_router_t *router, cr_strategy_t strategy);
cr_status_t cr_router_get_stats(const cr_router_t *router, cr_stats_t *stats);

#define klyn_router_create cr_router_create
#define klyn_router_destroy cr_router_destroy

#ifdef __cplusplus
}
#endif

#endif /* KLYN_COGNITIVE_ROUTER_H */
