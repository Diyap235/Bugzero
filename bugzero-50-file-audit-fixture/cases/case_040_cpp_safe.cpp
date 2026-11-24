#include <string>
std::string greeting(const std::string& name) {
    return std::string("Hello ") + name.substr(0, 80);
}
