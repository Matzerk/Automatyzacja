-- ════════════════════════════════════════════════════════════════
--  GILOTYNKA 🪓 — opcjonalne dane startowe (lista zadań z oryginału)
--  Uruchom DOPIERO po: (1) schema.sql, (2) rejestracji kont,
--  (3) ustawieniu choć jednego nadzorcy (role='supervisor').
--  created_by = pierwszy nadzorca w bazie.
-- ════════════════════════════════════════════════════════════════
do $$
declare sup uuid;
begin
  select id into sup from public.profiles where role='supervisor' order by created_at limit 1;
  if sup is null then
    raise exception 'Brak nadzorcy — najpierw ustaw role=supervisor (patrz koniec schema.sql).';
  end if;

  insert into public.tasks (name,type,priority,note,status,created_by) values
  ('Ścielenie łóżka','dc','dc','','w_realizacji',sup),
  ('Worek pod zlew','dc','dc','','w_realizacji',sup),
  ('Worek — plastiki i papiery','dc','dc','','w_realizacji',sup),
  ('Rachunki / wyceny','dc','dc','','w_realizacji',sup),
  ('Kupy — sprzątanie po Lei','dc','dc','','w_realizacji',sup),
  ('Sznurek na wisterię','once','1','','oczekiwanie',sup),
  ('Taras — wymycie karherem','once','1','','oczekiwanie',sup),
  ('Ziemia z warzywnika do worków','once','1','','oczekiwanie',sup),
  ('Tektury z kotłowni','once','1','','oczekiwanie',sup),
  ('Montaż warzywników','once','1','','oczekiwanie',sup),
  ('Zgrabienie liści z trawy','once','1','','oczekiwanie',sup),
  ('Skoszenie trawy','once','1','','oczekiwanie',sup),
  ('Wertykulacja trawy','once','1','','oczekiwanie',sup),
  ('Spacer z Leą','once','1','','oczekiwanie',sup),
  ('10 ofert pracy + wysłanie CV','once','1','','oczekiwanie',sup),
  ('Zbadanie opcji mieszkań','once','1','','oczekiwanie',sup),
  ('Szkolenie motywacyjne','once','1','','oczekiwanie',sup),
  ('Szukanie ofert pracy','once','1','Rano i przed obiadem','oczekiwanie',sup),
  ('Nauka na prawo jazdy','once','1','Nauka teorii, testy online','oczekiwanie',sup),
  ('Pójście na uczelnię','once','3','Pytania do starszych roczników','oczekiwanie',sup),
  ('Kontakt w sprawie studiów','once','3','','oczekiwanie',sup),
  ('Zebranie liści z ogrodu','once','3','Przy lepszej pogodzie','oczekiwanie',sup),
  ('Przesadzenie kwiatków','once','3','','oczekiwanie',sup),
  ('Wymogi na nowe studia','once','4','','oczekiwanie',sup),
  ('Prace w ogrodzie na wiosnę','once','4','','oczekiwanie',sup),
  ('Lodówka (sprawdzenie/uzupełnienie)','cyc','2','','oczekiwanie',sup);
end$$;
