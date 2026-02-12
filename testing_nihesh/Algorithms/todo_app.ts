interface Todo {
  id: number;
  title: string;
  completed: boolean;
  createdAt: Date;
}

class TodoService {
  private todos: Todo[] = [];
  private nextId = 1;

  add(title: string): Todo {
    const todo: Todo = {
      id: this.nextId++,
      title,
      completed: false,
      createdAt: new Date(),
    };
    this.todos.push(todo);
    return todo;
  }

  toggle(id: number): Todo | undefined {
    const todo = this.todos.find((t) => t.id === id);
    if (todo) todo.completed = !todo.completed;
    return todo;
  }

  getAll(): Todo[] {
    return [...this.todos];
  }

  getCompleted(): Todo[] {
    return this.todos.filter((t) => t.completed);
  }
}

const service = new TodoService();
service.add("Learn TypeScript");
service.add("Build a REST API");
console.log(service.getAll());
