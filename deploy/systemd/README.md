# Sicherung einrichten (systemd-Timer)

Auf dem Zielsystem ist **kein cron installiert** — ein `/etc/cron.d`-Eintrag wird dort
stillschweigend ignoriert. Die Sicherung laeuft deshalb ueber einen systemd-Timer.

```bash
sudo cp deploy/systemd/opensignage-backup.{service,timer} /etc/systemd/system/
sudo chmod 644 /etc/systemd/system/opensignage-backup.{service,timer}
sudo systemctl daemon-reload
sudo systemctl enable --now opensignage-backup.timer
```

Pruefen / manuell ausloesen:

```bash
systemctl list-timers opensignage-backup.timer   # naechster Lauf
sudo systemctl start opensignage-backup.service  # sofort sichern
ls -lah ~/opensignage-backups/                   # Ergebnis
tail ~/opensignage-backups/backup.log            # Protokoll
```

Ein Archiv ist erst dann eine echte Sicherung, wenn es sich lesen laesst:

```bash
tar tzf ~/opensignage-backups/<archiv>.tar.gz          # muss db.sql.gz + media.tar.gz zeigen
tar xzf ~/opensignage-backups/<archiv>.tar.gz -C /tmp/pruef && gunzip -t /tmp/pruef/db.sql.gz
zcat /tmp/pruef/db.sql.gz | tail -6                 # endet mit "PostgreSQL database dump complete"
```

Wiederherstellen: `sudo bash deploy/restore.sh ~/opensignage-backups/<archiv>.tar.gz`
