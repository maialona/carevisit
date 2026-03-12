import sqlite3
import os

db_path = "carevisit.db"

if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN avatar VARCHAR(50)")
        conn.commit()
        print("Successfully added 'avatar' column to 'users' table.")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e).lower():
            print("Column 'avatar' already exists.")
        else:
            print(f"Error: {e}")
    finally:
        conn.close()
else:
    print(f"Database file {db_path} not found. Migration skipped (tables will be created by SQLAlchemy).")
