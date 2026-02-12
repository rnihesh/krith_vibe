package com.example.repository;

import java.util.*;
import java.util.stream.Collectors;

public class UserRepository {
    private final Map<String, User> users = new HashMap<>();

    public record User(String id, String name, String email, int age) {}

    public void save(User user) {
        users.put(user.id(), user);
    }

    public Optional<User> findById(String id) {
        return Optional.ofNullable(users.get(id));
    }

    public List<User> findByAge(int minAge, int maxAge) {
        return users.values().stream()
            .filter(u -> u.age() >= minAge && u.age() <= maxAge)
            .sorted(Comparator.comparing(User::name))
            .collect(Collectors.toList());
    }

    public void deleteById(String id) {
        users.remove(id);
    }

    public int count() {
        return users.size();
    }
}
