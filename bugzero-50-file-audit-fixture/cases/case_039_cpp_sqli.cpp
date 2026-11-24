#include <string>
std::string make_query(const std::string& id) {
    return "SELECT * FROM users WHERE id = " + id;
}
