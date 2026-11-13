CREATE VIRTUAL TABLE IF NOT EXISTS event_search USING fts5(title, host_name, description, tags, content='events', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS event_search_ai AFTER INSERT ON events BEGIN
  INSERT INTO event_search(rowid,title,host_name,description,tags) VALUES (new.id,new.title,new.host_name,new.description,new.tags);
END;
CREATE TRIGGER IF NOT EXISTS event_search_ad AFTER DELETE ON events BEGIN
  INSERT INTO event_search(event_search,rowid,title,host_name,description,tags) VALUES ('delete',old.id,old.title,old.host_name,old.description,old.tags);
END;
CREATE TRIGGER IF NOT EXISTS event_search_au AFTER UPDATE ON events BEGIN
  INSERT INTO event_search(event_search,rowid,title,host_name,description,tags) VALUES ('delete',old.id,old.title,old.host_name,old.description,old.tags);
  INSERT INTO event_search(rowid,title,host_name,description,tags) VALUES (new.id,new.title,new.host_name,new.description,new.tags);
END;
INSERT INTO event_search(event_search) VALUES ('rebuild');
