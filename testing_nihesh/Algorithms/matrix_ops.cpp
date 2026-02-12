#include <iostream>
#include <vector>
#include <stdexcept>

class Matrix {
    std::vector<std::vector<double>> data;
    int rows, cols;

public:
    Matrix(int r, int c) : rows(r), cols(c), data(r, std::vector<double>(c, 0.0)) {}

    double& at(int r, int c) { return data[r][c]; }
    const double& at(int r, int c) const { return data[r][c]; }

    Matrix operator*(const Matrix& other) const {
        if (cols != other.rows) throw std::invalid_argument("Dimension mismatch");
        Matrix result(rows, other.cols);
        for (int i = 0; i < rows; i++)
            for (int j = 0; j < other.cols; j++)
                for (int k = 0; k < cols; k++)
                    result.at(i, j) += at(i, k) * other.at(k, j);
        return result;
    }

    void print() const {
        for (int i = 0; i < rows; i++) {
            for (int j = 0; j < cols; j++)
                std::cout << data[i][j] << " ";
            std::cout << "\n";
        }
    }
};

int main() {
    Matrix a(2, 3), b(3, 2);
    a.at(0, 0) = 1; a.at(0, 1) = 2; a.at(0, 2) = 3;
    a.at(1, 0) = 4; a.at(1, 1) = 5; a.at(1, 2) = 6;
    b.at(0, 0) = 7; b.at(0, 1) = 8;
    b.at(1, 0) = 9; b.at(1, 1) = 10;
    b.at(2, 0) = 11; b.at(2, 1) = 12;
    Matrix c = a * b;
    c.print();
    return 0;
}
