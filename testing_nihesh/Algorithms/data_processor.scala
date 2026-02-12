object DataProcessor {
  case class Student(name: String, grades: List[Double])

  def average(grades: List[Double]): Double =
    if (grades.isEmpty) 0.0 else grades.sum / grades.length

  def topStudents(students: List[Student], threshold: Double): List[Student] =
    students.filter(s => average(s.grades) >= threshold)

  def rankStudents(students: List[Student]): List[(Student, Int)] =
    students.sortBy(s => -average(s.grades)).zipWithIndex.map { case (s, i) => (s, i + 1) }

  def main(args: Array[String]): Unit = {
    val students = List(
      Student("Alice", List(95, 88, 92)),
      Student("Bob", List(78, 82, 85)),
      Student("Charlie", List(90, 95, 98)),
    )
    rankStudents(students).foreach { case (s, rank) =>
      println(s"$rank. ${s.name} (avg: ${average(s.grades)})")
    }
  }
}
