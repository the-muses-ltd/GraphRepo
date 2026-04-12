#include <iostream>
#include <vector>
#include "utils.h"

class Animal {
public:
    virtual void speak() = 0;
    int getAge() { return age; }
protected:
    int age;
};

class Dog : public Animal {
public:
    void speak() {}
};

void processItems(int x) {
}
