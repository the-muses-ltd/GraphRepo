#include <stdio.h>
#include "myheader.h"

static int internal_counter = 0;
int global_value = 42;

static void helper(void) {
    printf("helper\n");
}

int process(const char *input, int length) {
    helper();
    printf("%s\n", input);
    return length;
}
