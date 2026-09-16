#include "klyn_mmap_memory.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

static int map_fd = -1;
static void *mapped_region = NULL;
static size_t current_offset = 0;

int init_mmap_storage() {
    // Local directory file storage for Android/Termux compatibility
    map_fd = open("klyn_vector_store.db", O_RDWR | O_CREAT, 0666);
    if (map_fd < 0) return -1;
    if (ftruncate(map_fd, STORAGE_SIZE) < 0) return -1;
    
    mapped_region = mmap(NULL, STORAGE_SIZE, PROT_READ | PROT_WRITE, MAP_SHARED, map_fd, 0);
    if (mapped_region == MAP_FAILED) return -1;
    
    madvise(mapped_region, STORAGE_SIZE, MADV_SEQUENTIAL);
    return 0;
}

int commit_to_memory(const char *text) {
    if (!mapped_region || current_offset + sizeof(MemoryRecord) > STORAGE_SIZE) return -1;
    MemoryRecord rec;
    static size_t global_idx = 1;
    rec.index = global_idx++;
    strncpy(rec.payload, text, RECORD_MAX_LEN - 1);
    rec.payload[RECORD_MAX_LEN - 1] = '\0';
    void *dest = (char *)mapped_region + current_offset;
    memcpy(dest, &rec, sizeof(MemoryRecord));
    current_offset += sizeof(MemoryRecord);
    msync(mapped_region, STORAGE_SIZE, MS_ASYNC);
    return rec.index;
}

void cleanup_mmap_storage() {
    if (mapped_region) munmap(mapped_region, STORAGE_SIZE);
    if (map_fd >= 0) close(map_fd);
}
