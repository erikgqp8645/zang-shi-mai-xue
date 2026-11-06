CREATE OR REPLACE FUNCTION pulse_write_medication(p_owner text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_patient_id text := p_args->>'patientId';
  v_visit_id   text := p_args->>'visitId';
  v_rows       jsonb := coalesce(p_args->'rows', '[]'::jsonb);
  v_now        bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_row        jsonb;
  v_id         text;
  v_vid        text;
  v_name       text;
  v_pulse      text;
  v_symbols   text;
  v_adjust     text;
  v_usage      text;
  v_note       text;
  v_owner_of   text;
  v_exists     boolean;
  v_seq        integer;
  v_seqmap     jsonb := '{}'::jsonb;
  v_keep       text[] := ARRAY[]::text[];
BEGIN
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
    v_id := coalesce(nullif(v_row->>'id', ''),
                      'm' || substr(md5(random()::text || clock_timestamp()::text), 1, 10));
    v_vid := coalesce(nullif(v_row->>'visitId', ''), v_visit_id);
    v_name := trim(coalesce(v_row->>'name', ''));
    v_pulse := trim(coalesce(v_row->>'pulse', ''));
    v_adjust := trim(coalesce(v_row->>'adjust', ''));
    v_usage := trim(coalesce(v_row->>'usage', ''));
    v_note := trim(coalesce(v_row->>'note', ''));
    v_symbols := coalesce(v_row->>'symbols', '{}');

    IF v_name = '' AND v_pulse = '' AND v_adjust = '' AND v_usage = '' AND v_note = ''
       AND v_symbols = '{}' THEN
      CONTINUE;
    END IF;

    IF v_visit_id <> '' THEN
      SELECT true INTO v_exists FROM visits WHERE id = v_vid;
    ELSE
      SELECT true INTO v_exists FROM visits
      WHERE id = v_vid AND patient_id = v_patient_id AND owner_id = p_owner;
    END IF;
    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT owner_id INTO v_owner_of FROM medication WHERE id = v_id;
    IF v_owner_of IS NOT NULL AND v_owner_of <> p_owner THEN CONTINUE; END IF;

    v_seq := coalesce((v_seqmap->>v_vid)::integer, 0);
    v_seqmap := v_seqmap || jsonb_build_object(v_vid, v_seq + 1);

    INSERT INTO medication (id, patient_id, visit_id, owner_id, seq, name, pulse, symbols,
                            adjust, usage, note, created_at)
    VALUES (v_id, v_patient_id, v_vid, p_owner, v_seq, v_name, v_pulse, v_symbols,
            v_adjust, v_usage, v_note, v_now)
    ON CONFLICT (id) DO UPDATE SET
      visit_id = EXCLUDED.visit_id, seq = EXCLUDED.seq, owner_id = EXCLUDED.owner_id,
      name = EXCLUDED.name, pulse = EXCLUDED.pulse, symbols = EXCLUDED.symbols,
      adjust = EXCLUDED.adjust, usage = EXCLUDED.usage, note = EXCLUDED.note;

    v_keep := array_append(v_keep, v_id);
  END LOOP;

  IF v_visit_id <> '' THEN
    DELETE FROM medication WHERE visit_id = v_visit_id AND owner_id = p_owner
      AND NOT (id = ANY(v_keep));
  ELSE
    DELETE FROM medication WHERE patient_id = v_patient_id AND owner_id = p_owner
      AND NOT (id = ANY(v_keep));
  END IF;

  RETURN jsonb_build_object('kept', to_jsonb(v_keep));
END $$;
