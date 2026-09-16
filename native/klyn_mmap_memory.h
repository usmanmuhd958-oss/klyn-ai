#ifndef KLYN_MMAP_MEMORY_H
#define KLYN_MMAP_MEMORY_H
#include <stddef.h>
#define STORAGE_SIZE 4194304
#define RECORD_MAX_LEN 256
typedef struct { size_t index; char payload[RECORD_MAX_LEN]; } MemoryRecord;
int init_mmap_storage();
int commit_to_memory(const char *text);
void cleanup_mmap_storage();
#endif
