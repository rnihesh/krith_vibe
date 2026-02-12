import 'dart:convert';
import 'dart:io';

class Note {
  final String title;
  final String body;
  final DateTime createdAt;

  Note({required this.title, required this.body})
      : createdAt = DateTime.now();

  Map<String, dynamic> toJson() => {
        'title': title,
        'body': body,
        'createdAt': createdAt.toIso8601String(),
      };

  factory Note.fromJson(Map<String, dynamic> json) {
    return Note(title: json['title'], body: json['body']);
  }
}

class NoteManager {
  final List<Note> _notes = [];

  void add(String title, String body) => _notes.add(Note(title: title, body: body));

  List<Note> search(String query) =>
      _notes.where((n) => n.title.contains(query) || n.body.contains(query)).toList();

  String exportJson() => jsonEncode(_notes.map((n) => n.toJson()).toList());
}

void main() {
  final manager = NoteManager();
  manager.add('Shopping', 'Buy milk, eggs, bread');
  manager.add('Meeting', 'Team standup at 10am');
  print(manager.exportJson());
}
