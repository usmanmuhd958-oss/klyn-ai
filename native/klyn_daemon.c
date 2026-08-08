#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <pthread.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <string.h>
#include <time.h>
#include "klyn_mmap_memory.h"
#include "klyn_ipc.h"

#define NUM_AGENTS 3

typedef struct {
    char name[32];
    pthread_t thread_id;
    time_t last_heartbeat;
    int is_alive;
} AgentMetadata;

AgentMetadata supervisor_matrix[NUM_AGENTS] = {
    {"INTENT_ROUTER", 0, 0, 0},
    {"RETRIEVAL_MEMORY", 0, 0, 0},
    {"EXECUTION_CORE", 0, 0, 0}
};

pthread_mutex_t matrix_mutex = PTHREAD_MUTEX_INITIALIZER;

void *agent_worker(void *arg) {
    int agent_idx = *(int *)arg;
    free(arg);
    
    char thread_name[32];
    pthread_mutex_lock(&matrix_mutex);
    strncpy(thread_name, supervisor_matrix[agent_idx].name, sizeof(thread_name));
    supervisor_matrix[agent_idx].is_alive = 1;
    pthread_mutex_unlock(&matrix_mutex);

    printf("[KLYN SCHEDULER] Agent Worker [%s] active and reporting health\n", thread_name);

    while (1) {
        pthread_mutex_lock(&matrix_mutex);
        supervisor_matrix[agent_idx].last_heartbeat = time(NULL);
        pthread_mutex_unlock(&matrix_mutex);
        
        // Simulating highly intense runtime loops
        sleep(2);
    }
    return NULL;
}

void spawn_agent(int idx) {
    int *arg = malloc(sizeof(*arg));
    *arg = idx;
    pthread_create(&supervisor_matrix[idx].thread_id, NULL, agent_worker, arg);
}

void *supervisor_watchdog(void *arg) {
    (void)arg;
    printf("[KLYN SUPERVISOR] Self-Healing Watchdog Engine running...\n");
    
    while (1) {
        sleep(5); // Health check interval
        time_t now = time(NULL);
        
        pthread_mutex_lock(&matrix_mutex);
        for (int i = 0; i < NUM_AGENTS; i++) {
            if (!supervisor_matrix[i].is_alive || (now - supervisor_matrix[i].last_heartbeat) > 6) {
                printf("[⚠️ SELF-HEALING] Alert: Agent [%s] missing heartbeat! Restarting agent...\n", supervisor_matrix[i].name);
                // Self-healing injection
                spawn_agent(i);
            }
        }
        pthread_mutex_unlock(&matrix_mutex);
    }
    return NULL;
}

int main() {
    printf("===============================================================\n");
    printf("  KLYN AI OS CORE - NATIVE LINUX MICROKERNEL v3.1.0            \n");
    printf("  INTEGRATED SYSTEM: SELF-HEALING SUPERVISOR WATCHDOG          \n");
    printf("===============================================================\n");
    
    if (init_mmap_storage() < 0) { perror("mmap error"); exit(1); }
    int server_fd = init_ipc_socket();
    if (server_fd < 0) { perror("IPC socket error"); exit(1); }
    
    printf("[KLYN IPC] Zero-Copy Domain Socket active at klyn_ipc.sock\n");

    // Spawn the core active agents
    pthread_mutex_lock(&matrix_mutex);
    for (int i = 0; i < NUM_AGENTS; i++) {
        spawn_agent(i);
    }
    pthread_mutex_unlock(&matrix_mutex);

    // Run the Supervisor Engine inside a background thread
    pthread_t watchdog_id;
    pthread_create(&watchdog_id, NULL, supervisor_watchdog, NULL);

    while (1) {
        int client_fd = accept(server_fd, NULL, NULL);
        if (client_fd >= 0) {
            char buffer[512] = {0};
            read(client_fd, buffer, sizeof(buffer) - 1);
            int idx = commit_to_memory(buffer);
            char response[128];
            snprintf(response, sizeof(response), "[KLYN_CORE_ACK] Page Record #%d committed.\n", idx);
            write(client_fd, response, strlen(response));
            close(client_fd);
        }
    }
    
    cleanup_mmap_storage();
    return 0;
}
