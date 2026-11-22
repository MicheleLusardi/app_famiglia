# Spesa famiglia

PWA per lista della spesa condivisa e registrazione spese mensili.
Frontend statico (GitHub Pages) + Supabase (database, login, realtime).

## Setup

### 1. Configurazione
In `config.js` inserire **Project URL** e chiave **pubblica** (anon / publishable)
da Supabase > Project Settings > API. Mai la chiave `service_role`/secret.

### 2. Utenti (Supabase)
1. Authentication > Users > **Add user > Create new user**: email + password, spuntare *Auto Confirm User*.
2. Abilitarlo come membro (SQL Editor):
   ```sql
   insert into membri (user_id, nome)
   select id, 'Michele' from auth.users where email = 'email@esempio.it';
   ```
3. Disattivare le registrazioni pubbliche: Authentication > impostazioni di Sign In / Providers >
   disattivare *Allow new users to sign up*.

### 3. Pubblicazione (GitHub Pages)
Settings > Pages > Source: *Deploy from a branch* > `main` / `(root)` > Save.
URL: `https://<utente>.github.io/app-famiglia/`

### 4. Installazione sul telefono
- Android (Chrome): menu > *Aggiungi a schermata Home* / *Installa app*.
- iPhone (Safari): Condividi > *Aggiungi a Home*.

## File
| File | Contenuto |
|---|---|
| `index.html` | struttura delle schermate |
| `app.js` | logica (login, lista, spese, report) |
| `config.js` | URL e chiave pubblica Supabase |
| `style.css` | grafica |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | installazione come app |
