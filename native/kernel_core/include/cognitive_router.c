/**
 * @file cognitive_router.c
 * @brief KLYN AI OS - Enterprise C11 Lock-Free Cognitive Router Implementation
 */

#include "cognitive_router.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdatomic.h>
#include <pthread.h>

typedef struct __attribute__((aligned(CR_CACHE_LINE_SIZE))) {
    char route_id[CR_MAX_ROUTE_ID_LEN];
    uint32_t weight;
    uint32_t max_concurrency;
    uint32_t timeout_ms;
    _Atomic uint32_t active_connections;
    _Atomic uint64_t total_hits;
    _Atomic bool enabled;
    _Atomic bool occupied;
    double ema_latency_ms;
} cr_route_internal_t;

struct __attribute__((aligned(CR_CACHE_LINE_SIZE))) cr_router {
    cr_config_t config;
    _Atomic size_t active_routes_count;
    _Atomic uint64_t total_routed_count;
    _Atomic uint64_t rr_index;
    _Atomic cr_strategy_t strategy;
    pthread_mutex_t write_lock;
    cr_route_internal_t *routes;
};

cr_status_t cr_router_get_default_config(cr_config_t *config) {
    if (config == NULL) return CR_ERROR_NULL_POINTER;
    config->max_routes = 256;
    config->arena_block_size = 65536;
    config->strategy = CR_STRATEGY_ROUND_ROBIN;
    return CR_SUCCESS;
}

cr_status_t cr_router_create(const cr_config_t *config, cr_router_t **router) {
    if (config == NULL || router == NULL) return CR_ERROR_NULL_POINTER;
    if (config->max_routes == 0) return CR_ERROR_INVALID_PARAM;

    cr_router_t *r = (cr_router_t *)malloc(sizeof(cr_router_t));
    if (r == NULL) return CR_ERROR_INVALID_PARAM;

    memset(r, 0, sizeof(cr_router_t));
    r->config = *config;

    r->routes = (cr_route_internal_t *)calloc(config->max_routes, sizeof(cr_route_internal_t));
    if (r->routes == NULL) {
        free(r);
        return CR_ERROR_INVALID_PARAM;
    }

    pthread_mutex_init(&r->write_lock, NULL);
    atomic_store(&r->active_routes_count, 0);
    atomic_store(&r->total_routed_count, 0);
    atomic_store(&r->rr_index, 0);
    atomic_store(&r->strategy, config->strategy);

    *router = r;
    return CR_SUCCESS;
}

cr_status_t cr_router_destroy(cr_router_t *router) {
    if (router == NULL) return CR_ERROR_NULL_POINTER;
    pthread_mutex_destroy(&router->write_lock);
    if (router->routes != NULL) {
        free(router->routes);
    }
    free(router);
    return CR_SUCCESS;
}

cr_status_t cr_router_register_route(cr_router_t *router, const cr_route_config_t *route_config) {
    if (router == NULL || route_config == NULL) return CR_ERROR_NULL_POINTER;

    /* Validate invalid parameters: empty route_id, zero weight, zero max_concurrency */
    if (route_config->route_id[0] == '\0' || 
        route_config->weight == 0 || 
        route_config->max_concurrency == 0) {
        return CR_ERROR_INVALID_PARAM;
    }

    pthread_mutex_lock(&router->write_lock);

    for (size_t i = 0; i < router->config.max_routes; i++) {
        if (atomic_load(&router->routes[i].occupied)) {
            if (strncmp(router->routes[i].route_id, route_config->route_id, CR_MAX_ROUTE_ID_LEN) == 0) {
                pthread_mutex_unlock(&router->write_lock);
                return CR_ERROR_ROUTE_EXISTS;
            }
        }
    }

    int free_idx = -1;
    for (size_t i = 0; i < router->config.max_routes; i++) {
        if (atomic_load(&router->routes[i].occupied) == false) {
            free_idx = (int)i;
            break;
        }
    }

    if (free_idx == -1) {
        pthread_mutex_unlock(&router->write_lock);
        return CR_ERROR_CAPACITY_EXCEEDED;
    }

    cr_route_internal_t *slot = &router->routes[free_idx];
    memset(slot->route_id, 0, CR_MAX_ROUTE_ID_LEN);
    strncpy(slot->route_id, route_config->route_id, CR_MAX_ROUTE_ID_LEN - 1);
    slot->weight = route_config->weight;
    slot->max_concurrency = route_config->max_concurrency;
    slot->timeout_ms = route_config->timeout_ms;
    slot->ema_latency_ms = 1.0;

    atomic_store(&slot->active_connections, 0);
    atomic_store(&slot->total_hits, 0);
    atomic_store(&slot->enabled, route_config->enabled);
    atomic_store(&slot->occupied, true);

    atomic_fetch_add(&router->active_routes_count, 1);

    pthread_mutex_unlock(&router->write_lock);
    return CR_SUCCESS;
}

cr_status_t cr_router_unregister_route(cr_router_t *router, const char *route_id) {
    if (router == NULL || route_id == NULL) return CR_ERROR_NULL_POINTER;

    pthread_mutex_lock(&router->write_lock);

    for (size_t i = 0; i < router->config.max_routes; i++) {
        if (atomic_load(&router->routes[i].occupied)) {
            if (strncmp(router->routes[i].route_id, route_id, CR_MAX_ROUTE_ID_LEN) == 0) {
                atomic_store(&router->routes[i].enabled, false);
                atomic_store(&router->routes[i].occupied, false);
                atomic_fetch_sub(&router->active_routes_count, 1);
                pthread_mutex_unlock(&router->write_lock);
                return CR_SUCCESS;
            }
        }
    }

    pthread_mutex_unlock(&router->write_lock);
    return CR_ERROR_ROUTE_NOT_FOUND;
}

cr_status_t cr_router_get_route(const cr_router_t *router, const char *route_id, cr_route_config_t *route_config) {
    if (router == NULL || route_id == NULL || route_config == NULL) return CR_ERROR_NULL_POINTER;

    for (size_t i = 0; i < router->config.max_routes; i++) {
        if (atomic_load(&router->routes[i].occupied)) {
            if (strncmp(router->routes[i].route_id, route_id, CR_MAX_ROUTE_ID_LEN) == 0) {
                memset(route_config->route_id, 0, CR_MAX_ROUTE_ID_LEN);
                strncpy(route_config->route_id, router->routes[i].route_id, CR_MAX_ROUTE_ID_LEN - 1);
                route_config->weight = router->routes[i].weight;
                route_config->max_concurrency = router->routes[i].max_concurrency;
                route_config->timeout_ms = router->routes[i].timeout_ms;
                route_config->enabled = atomic_load(&router->routes[i].enabled);
                return CR_SUCCESS;
            }
        }
    }

    return CR_ERROR_ROUTE_NOT_FOUND;
}

cr_status_t cr_router_set_strategy(cr_router_t *router, cr_strategy_t strategy) {
    if (router == NULL) return CR_ERROR_NULL_POINTER;
    atomic_store(&router->strategy, strategy);
    return CR_SUCCESS;
}

cr_status_t cr_router_get_stats(const cr_router_t *router, cr_stats_t *stats) {
    if (router == NULL || stats == NULL) return CR_ERROR_NULL_POINTER;
    stats->active_routes = atomic_load(&router->active_routes_count);
    stats->total_routed = atomic_load(&router->total_routed_count);
    return CR_SUCCESS;
}

cr_status_t cr_router_route(cr_router_t *router, const cr_context_t *context, cr_decision_t *decision) {
    if (router == NULL || context == NULL || decision == NULL) return CR_ERROR_NULL_POINTER;

    size_t active_count = atomic_load(&router->active_routes_count);
    if (active_count == 0) return CR_ERROR_NO_ACTIVE_ROUTES;

    cr_strategy_t current_strategy = atomic_load(&router->strategy);
    int selected_idx = -1;

    switch (current_strategy) {
        case CR_STRATEGY_ROUND_ROBIN: {
            uint64_t idx = atomic_fetch_add(&router->rr_index, 1);
            for (size_t i = 0; i < router->config.max_routes; i++) {
                size_t target = (idx + i) % router->config.max_routes;
                if (atomic_load(&router->routes[target].occupied) &&
                    atomic_load(&router->routes[target].enabled)) {
                    selected_idx = (int)target;
                    break;
                }
            }
            break;
        }
        case CR_STRATEGY_LEAST_CONNECTIONS: {
            uint32_t min_conns = UINT32_MAX;
            for (size_t i = 0; i < router->config.max_routes; i++) {
                if (atomic_load(&router->routes[i].occupied) &&
                    atomic_load(&router->routes[i].enabled)) {
                    uint32_t conns = atomic_load(&router->routes[i].active_connections);
                    if (conns < min_conns) {
                        min_conns = conns;
                        selected_idx = (int)i;
                    }
                }
            }
            break;
        }
        default: {
            for (size_t i = 0; i < router->config.max_routes; i++) {
                if (atomic_load(&router->routes[i].occupied) &&
                    atomic_load(&router->routes[i].enabled)) {
                    selected_idx = (int)i;
                    break;
                }
            }
            break;
        }
    }

    if (selected_idx == -1) return CR_ERROR_NO_ACTIVE_ROUTES;

    cr_route_internal_t *chosen = &router->routes[selected_idx];
    atomic_fetch_add(&chosen->total_hits, 1);
    atomic_fetch_add(&router->total_routed_count, 1);

    memset(decision->route_id, 0, CR_MAX_ROUTE_ID_LEN);
    strncpy(decision->route_id, chosen->route_id, CR_MAX_ROUTE_ID_LEN - 1);
    decision->confidence = 0.99;

    return CR_SUCCESS;
}
