-- E3-07: temperatura informada no diário (febre >= 38 °C).
-- TEXT porque recebe envelope AES da aplicação, como os demais campos clínicos.
ALTER TABLE daily_entries ADD COLUMN IF NOT EXISTS temperature_c TEXT;
