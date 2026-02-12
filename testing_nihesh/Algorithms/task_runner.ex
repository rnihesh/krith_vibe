defmodule TaskRunner do
  @moduledoc "Simple concurrent task runner using Elixir processes."

  def run_parallel(tasks) when is_list(tasks) do
    tasks
    |> Enum.map(fn task ->
      Task.async(fn -> execute(task) end)
    end)
    |> Enum.map(&Task.await/1)
  end

  defp execute({:fetch, url}) do
    IO.puts("Fetching #{url}...")
    {:ok, "content from #{url}"}
  end

  defp execute({:compute, n}) do
    result = Enum.reduce(1..n, 0, &+/2)
    {:ok, result}
  end
end

tasks = [
  {:fetch, "https://example.com"},
  {:compute, 1_000_000},
  {:fetch, "https://api.example.com/data"},
]

results = TaskRunner.run_parallel(tasks)
IO.inspect(results, label: "Results")
