#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <pthread.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <string.h>
#include "klyn_mmap_memory.h"
#include "klyn_ipc.h"
void *agent_worker(void *arg) {
    char *name = (char *)arg;
    printf("[KLYN SCHEDULER] Agent Worker [%s] active\n", name);
    return NULL;
}
int main() {
    printf("===============================================================\n");
    printf("  KLYN AI OS CORE - NATIVE LINUX MICROKERNEL v3.0.0            \n");
    printf("===============================================================\n");
    if (init_mmap_storage() < 0) { perror("mmap error"); exit(1); }
    int server_fd = init_ipc_socket();
    if (server_fd < 0) { perror("IPC socket error"); exit(1); }
    printf("[KLYN IPC] Zero-Copy Domain Socket active at /tmp/klyn_ipc.sock\n");
    pthread_t t1, t2, t3;
    pthread_create(&t1, NULL, agent_worker, "INTENT_ROUTER");
    pthread_create(&t2, NULL, agent_worker, "RETRIEVAL_MEMORY");
    pthread_create(&t3, NULL, agent_worker, "EXECUTION_CORE");
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
