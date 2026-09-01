# Projekt-Hinweise

## Kommunikation mit dem Nutzer

- Wenn der Nutzer selbst etwas tun soll, immer eine Schritt-für-Schritt-Anleitung
  in Stichpunkten geben — nummeriert, ein Schritt pro Zeile, kein Fließtext.
- Konkret sein: welche Datei, welche Taste, welcher Befehl.
- Antworten auf Deutsch.

## Zum Projekt

Reine HTML/CSS/JS-Seite ohne Build-Schritt, ohne Framework, ohne CDN.
Muss in Safari direkt über `file://` laufen — deshalb:

- Keine ES-Module (`type="module"`), nur klassische `<script src>`-Tags.
- Keine externen Ressourcen (Fonts, Libraries). Alles lokal.
- Farben stehen doppelt: `CONFIG` in `js/app.js` (Canvas) und CSS-Variablen
  in `styles.css` (HUD). Beim Umfärben beide anpassen.
