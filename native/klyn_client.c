#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <string.h>
#include "klyn_ipc.h"
int main(int argc, char *argv[]) {
    if (argc < 2) { printf("Usage: %s \"message\"\n", argv[0]); return 1; }
    int client_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, SOCKET_PATH, sizeof(addr.sun_path) - 1);
    if (connect(client_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) { perror("Connection failed"); return 1; }
    write(client_fd, argv[1], strlen(argv[1]));
    char response[128] = {0};
    read(client_fd, response, sizeof(response) - 1);
    printf("Kernel Acknowledgment: %s", response);
    close(client_fd);
    return 0;
}
