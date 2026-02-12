use std::fs;
use std::io::{self, BufRead};
use std::path::Path;
use std::collections::HashMap;

fn count_words(path: &Path) -> io::Result<HashMap<String, usize>> {
    let file = fs::File::open(path)?;
    let reader = io::BufReader::new(file);
    let mut counts: HashMap<String, usize> = HashMap::new();

    for line in reader.lines() {
        let line = line?;
        for word in line.split_whitespace() {
            let word = word.to_lowercase();
            *counts.entry(word).or_insert(0) += 1;
        }
    }
    Ok(counts)
}

fn main() {
    let path = Path::new("sample.txt");
    match count_words(path) {
        Ok(counts) => {
            let mut sorted: Vec<_> = counts.into_iter().collect();
            sorted.sort_by(|a, b| b.1.cmp(&a.1));
            for (word, count) in sorted.iter().take(10) {
                println!("{}: {}", word, count);
            }
        }
        Err(e) => eprintln!("Error: {}", e),
    }
}
