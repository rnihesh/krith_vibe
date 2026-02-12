(ns data-transform.core
  (:require [clojure.string :as str]))

(defn parse-csv-line [line]
  (str/split line #","))

(defn csv->maps [csv-string]
  (let [lines (str/split-lines csv-string)
        headers (map keyword (parse-csv-line (first lines)))
        rows (map parse-csv-line (rest lines))]
    (map #(zipmap headers %) rows)))

(defn aggregate [data group-key agg-key agg-fn]
  (->> data
       (group-by group-key)
       (map (fn [[k vs]] [k (agg-fn (map #(Double/parseDouble (agg-key %)) vs))]))
       (into {})))

(def csv-data
  "name,department,salary\nAlice,Engineering,95000\nBob,Marketing,75000\nCharlie,Engineering,105000")

(let [data (csv->maps csv-data)]
  (println "Parsed:" data)
  (println "Avg salary by dept:" (aggregate data :department :salary #(/ (reduce + %) (count %)))))
