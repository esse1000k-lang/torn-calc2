const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class ChatDatabase {
    constructor() {
        this.db = null;
        this.dbPath = path.join(__dirname, 'chat-messages.db');
    }

    // 데이터베이스 연결 및 초기화
    async connect() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('SQLite 연결 오류:', err);
                    return reject(err);
                }
                console.log('SQLite 데이터베이스에 연결되었습니다.');
                this.initializeDatabase().then(resolve).catch(reject);
            });
        });
    }

    // 데이터베이스 초기화 (테이블 생성)
    async initializeDatabase() {
        return new Promise((resolve, reject) => {
            const createTableSQL = `
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nickname TEXT NOT NULL,
                    message TEXT NOT NULL,
                    room TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
                CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room);
            `;

            this.db.exec(createTableSQL, (err) => {
                if (err) {
                    console.error('테이블 생성 오류:', err);
                    return reject(err);
                }
                console.log('메시지 테이블이 초기화되었습니다.');
                resolve();
            });
        });
    }

    // 메시지 저장
    async saveMessage(nickname, message, room) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO messages (nickname, message, room) VALUES (?, ?, ?)`;
            this.db.run(sql, [nickname, message, room], function(err) {
                if (err) {
                    console.error('메시지 저장 오류:', err);
                    return reject(err);
                }
                resolve({ id: this.lastID });
            });
        });
    }

    // 특정 방의 메시지 조회
    async getMessages(room, limit = 100) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT id, nickname, message, room, 
                       strftime('%Y-%m-%d %H:%M:%S', created_at) as created_at 
                FROM messages 
                WHERE room = ? 
                ORDER BY created_at DESC 
                LIMIT ?
            `;
            
            this.db.all(sql, [room, limit], (err, rows) => {
                if (err) {
                    console.error('메시지 조회 오류:', err);
                    return reject(err);
                }
                resolve(rows.reverse()); // 최신 메시지가 아래로 오도록 정렬
            });
        });
    }

    // 180일 이상된 메시지 삭제
    async cleanupOldMessages(days = 180) {
        return new Promise((resolve, reject) => {
            const sql = `DELETE FROM messages WHERE created_at < datetime('now', ?)`;
            this.db.run(sql, [`-${days} days`], function(err) {
                if (err) {
                    console.error('오래된 메시지 삭제 오류:', err);
                    return reject(err);
                }
                console.log(`삭제된 오래된 메시지: ${this.changes}개`);
                resolve(this.changes);
            });
        });
    }

    // 데이터베이스 연결 종료
    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    console.error('데이터베이스 연결 종료 오류:', err);
                } else {
                    console.log('데이터베이스 연결이 종료되었습니다.');
                }
            });
        }
    }

    // 통계 정보 조회
    async getStats() {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT 
                    COUNT(*) as total_messages,
                    COUNT(DISTINCT room) as total_rooms,
                    COUNT(DISTINCT nickname) as total_users
                FROM messages
            `;
            
            this.db.get(sql, (err, row) => {
                if (err) {
                    console.error('통계 조회 오류:', err);
                    return reject(err);
                }
                resolve(row);
            });
        });
    }
}

// 싱글톤 인스턴스 생성
const chatDB = new ChatDatabase();

module.exports = chatDB;