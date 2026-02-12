const std = @import("std");

const Allocator = std.mem.Allocator;

pub fn Stack(comptime T: type) type {
    return struct {
        const Self = @This();
        items: std.ArrayList(T),

        pub fn init(allocator: Allocator) Self {
            return .{ .items = std.ArrayList(T).init(allocator) };
        }

        pub fn push(self: *Self, value: T) !void {
            try self.items.append(value);
        }

        pub fn pop(self: *Self) ?T {
            if (self.items.items.len == 0) return null;
            return self.items.pop();
        }

        pub fn peek(self: *const Self) ?T {
            if (self.items.items.len == 0) return null;
            return self.items.items[self.items.items.len - 1];
        }
    };
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    var stack = Stack(i32).init(allocator);
    try stack.push(10);
    try stack.push(20);
    std.debug.print("Top: {}\n", .{stack.peek().?});
}
