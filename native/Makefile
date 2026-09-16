CC = clang
CFLAGS = -O3 -Wall -Wextra -pthread -std=c11
TARGETS = klyn_daemon klyn_client

all: $(TARGETS)

klyn_daemon: klyn_daemon.c klyn_ipc.c klyn_mmap_memory.c
	$(CC) $(CFLAGS) -o klyn_daemon klyn_daemon.c klyn_ipc.c klyn_mmap_memory.c

klyn_client: klyn_client.c
	$(CC) $(CFLAGS) -o klyn_client klyn_client.c

clean:
	rm -f $(TARGETS)
