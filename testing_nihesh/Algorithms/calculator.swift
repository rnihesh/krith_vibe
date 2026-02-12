import Foundation

struct Calculator {
    func add(_ a: Double, _ b: Double) -> Double { a + b }
    func subtract(_ a: Double, _ b: Double) -> Double { a - b }
    func multiply(_ a: Double, _ b: Double) -> Double { a * b }
    func divide(_ a: Double, _ b: Double) -> Double? {
        guard b != 0 else { return nil }
        return a / b
    }
}

let calc = Calculator()
print("10 + 5 = \(calc.add(10, 5))")
print("10 / 3 = \(calc.divide(10, 3) ?? 0)")
