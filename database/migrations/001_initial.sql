CREATE TABLE IF NOT EXISTS chp_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin', 'ngo', 'volunteer') NOT NULL,
      phone VARCHAR(30),
      location VARCHAR(200),
      interest VARCHAR(255),
      description TEXT,
      status ENUM('pending', 'approved', 'rejected')
        NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chp_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ngo_id INT NOT NULL,
      title VARCHAR(200) NOT NULL,
      description TEXT NOT NULL,
      event_date DATE NOT NULL,
      location VARCHAR(255) NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      capacity INT NOT NULL DEFAULT 1,
      status ENUM('pending', 'approved', 'rejected')
        NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_chp_event_ngo
        FOREIGN KEY (ngo_id) REFERENCES chp_users(id)
        ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chp_event_participants (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_id INT NOT NULL,
      volunteer_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_chp_participation (event_id, volunteer_id),
      CONSTRAINT fk_chp_participant_event
        FOREIGN KEY (event_id) REFERENCES chp_events(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_chp_participant_volunteer
        FOREIGN KEY (volunteer_id) REFERENCES chp_users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
