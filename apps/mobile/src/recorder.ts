import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { RecordingHeader, Sample } from '@core/types.ts';

/**
 * Zapis nagrania do pliku .jsonl na telefonie.
 *
 * Dlaczego to jest KRYTYCZNE, a nie "nice to have": bez nagrań każda zmiana
 * algorytmu wymaga ponownego spaceru po budynku. Z nagraniami cały zespół
 * stroi algorytm w Node w sekundach (packages/replay). Jedno nagranie z
 * dobrym ground truth jest warte więcej niż 10 godzin zgadywania parametrów.
 *
 * Bufor + flush, bo zapis co próbkę przy 100 Hz zabije I/O.
 */
export class Recorder {
  private buf: string[] = [];
  private path = '';
  private flushing = false;
  active = false;
  written = 0;

  async start(header: RecordingHeader): Promise<string> {
    const dir = `${FileSystem.documentDirectory}recordings/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    this.path = `${dir}${header.session_id}.jsonl`;
    await FileSystem.writeAsStringAsync(this.path, JSON.stringify(header) + '\n');
    this.buf = [];
    this.written = 0;
    this.active = true;
    return this.path;
  }

  push(s: Sample): void {
    if (!this.active) return;
    this.buf.push(JSON.stringify(s));
    if (this.buf.length >= 500) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.buf.length || !this.path) return;
    this.flushing = true;
    const chunk = this.buf.join('\n') + '\n';
    this.buf = [];
    try {
      const prev = await FileSystem.readAsStringAsync(this.path);
      await FileSystem.writeAsStringAsync(this.path, prev + chunk);
      this.written += chunk.length;
    } finally {
      this.flushing = false;
    }
  }

  async stop(): Promise<string> {
    await this.flush();
    this.active = false;
    return this.path;
  }

  /** Wyciągnięcie pliku z telefonu (share sheet -> Drive/Slack/kabel). */
  async share(): Promise<void> {
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(this.path);
  }

  async list(): Promise<string[]> {
    const dir = `${FileSystem.documentDirectory}recordings/`;
    return FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);
  }
}
