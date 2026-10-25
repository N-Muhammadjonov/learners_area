CREATE TABLE user_profile_photos (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  image_base64 text NOT NULL CHECK (length(image_base64) BETWEEN 4 AND 409600),
  content_type varchar(30) NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
