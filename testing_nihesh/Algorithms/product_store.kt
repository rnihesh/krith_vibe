package com.example

data class Product(val name: String, val price: Double, val category: String)

class ProductStore {
    private val products = mutableListOf<Product>()

    fun add(product: Product) = products.add(product)

    fun findByCategory(category: String): List<Product> =
        products.filter { it.category.equals(category, ignoreCase = true) }

    fun totalRevenue(): Double = products.sumOf { it.price }

    fun cheapest(): Product? = products.minByOrNull { it.price }

    fun mostExpensive(): Product? = products.maxByOrNull { it.price }

    fun groupByCategory(): Map<String, List<Product>> = products.groupBy { it.category }
}

fun main() {
    val store = ProductStore()
    store.add(Product("Laptop", 999.99, "Electronics"))
    store.add(Product("Coffee", 4.99, "Food"))
    store.add(Product("Mouse", 29.99, "Electronics"))
    println("Total: ${store.totalRevenue()}")
    println("Cheapest: ${store.cheapest()}")
}
