-- =============================================================================
-- MomTest AI - PostgreSQL Schema
-- Supabase üzerinde çalıştırılacak migration scripti
-- Çalıştırma: Supabase Dashboard → SQL Editor → Bu dosyayı yapıştır ve çalıştır
-- =============================================================================

-- =============================================================================
-- 1. PROFILES
-- Supabase Auth (auth.users) ile senkronize kullanıcı profili tablosu.
-- Her yeni auth kaydında otomatik olarak bir profil satırı oluşturulur.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
    id          UUID        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    email       TEXT        NOT NULL,
    full_name   TEXT,
    avatar_url  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS 'Supabase Auth kullanıcılarıyla birebir senkronize profil tablosu.';

-- Yeni auth kaydında otomatik profil oluşturan trigger fonksiyonu
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data ->> 'full_name',
        NEW.raw_user_meta_data ->> 'avatar_url'
    );
    RETURN NEW;
END;
$$;

-- Trigger: auth.users'a yeni kayıt geldiğinde profil oluştur
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();


-- =============================================================================
-- 2. PROJECTS
-- PM Intake sürecinin çıktılarını ve proje meta verilerini saklar.
-- research_brief ve interview_script alanları AI tarafından üretilen JSONB'dir.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.projects (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    product_idea     TEXT        NOT NULL,
    research_brief   JSONB,
    interview_script JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.projects              IS 'Her kullanıcının ürün keşif projelerini tutar.';
COMMENT ON COLUMN public.projects.product_idea     IS 'Kullanıcının intake formuna girdiği ham ürün fikri metni.';
COMMENT ON COLUMN public.projects.research_brief   IS 'AI tarafından üretilen araştırma özeti (hedef kitle, hipotezler, vb.)';
COMMENT ON COLUMN public.projects.interview_script IS 'AI tarafından üretilen mülakat senaryosu (sorular, sırası, vb.)';


-- =============================================================================
-- 3. INTERVIEWS
-- Her mülakat oturumunu, transcript'i, sinyal skorunu ve analiz raporunu tutar.
-- status enum benzeri TEXT CHECK ile korunur.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.interviews (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID        NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
    participant_name TEXT        NOT NULL,
    participant_role TEXT,
    status           TEXT        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'ongoing', 'completed')),
    transcript       JSONB,
    signal_score     JSONB,
    evidence_report  TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.interviews                   IS 'Proje başına yürütülen mülakatları ve analiz sonuçlarını tutar.';
COMMENT ON COLUMN public.interviews.status            IS 'Mülakat durumu: pending | ongoing | completed';
COMMENT ON COLUMN public.interviews.transcript        IS 'Tüm konuşmanın yapılandırılmış JSON formatında kaydı.';
COMMENT ON COLUMN public.interviews.signal_score      IS 'Evidence rubric çıktısına göre AI tarafından hesaplanan sinyal skorları.';
COMMENT ON COLUMN public.interviews.evidence_report   IS 'AI tarafından üretilen serbest metin kanıt analizi raporu.';


-- =============================================================================
-- 4. MESSAGES
-- Tek bir mülakat oturumundaki tüm mesajları sıralı olarak saklar.
-- sender: 'agent' (AI) veya 'participant' (katılımcı).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.messages (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    interview_id UUID        NOT NULL REFERENCES public.interviews (id) ON DELETE CASCADE,
    sender       TEXT        NOT NULL CHECK (sender IN ('agent', 'participant')),
    content      TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.messages             IS 'Mülakat oturumundaki sıralı mesaj kayıtları.';
COMMENT ON COLUMN public.messages.sender      IS 'Mesajı gönderen taraf: agent (AI) veya participant (katılımcı).';
COMMENT ON COLUMN public.messages.content     IS 'Mesajın ham metin içeriği.';


-- =============================================================================
-- 5. PERFORMANS İNDEKSLERİ
-- Sık kullanılan sorgu desenlerine göre tasarlanmıştır.
-- =============================================================================

-- Bir projeye ait tüm mülakatları getir
CREATE INDEX IF NOT EXISTS idx_interviews_project_id
    ON public.interviews (project_id);

-- Bir mülakata ait tüm mesajları getir (created_at sıralamasıyla)
CREATE INDEX IF NOT EXISTS idx_messages_interview_id
    ON public.messages (interview_id, created_at ASC);

-- Duruma göre mülakat filtreleme (örn: tüm 'pending' mülakatlar)
CREATE INDEX IF NOT EXISTS idx_interviews_status
    ON public.interviews (status);

-- Kullanıcıya ait projeleri getir (Dashboard ana sorgusu)
CREATE INDEX IF NOT EXISTS idx_projects_user_id
    ON public.projects (user_id, created_at DESC);


-- =============================================================================
-- 6. UPDATED_AT OTO-GÜNCELLEME TRİGGER'I
-- updated_at sütununu her UPDATE işleminde otomatik olarak günceller.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_projects_updated_at    ON public.projects;
CREATE TRIGGER set_projects_updated_at
    BEFORE UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_interviews_updated_at  ON public.interviews;
CREATE TRIGGER set_interviews_updated_at
    BEFORE UPDATE ON public.interviews
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_profiles_updated_at    ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- 7. ROW LEVEL SECURITY (RLS) POLİTİKALARI
-- Her kimliği doğrulanmış kullanıcı yalnızca kendi verilerine erişebilir.
-- Public interview erişimi için ayrı politika eklenmiştir (katılımcı görünümü).
-- =============================================================================

-- RLS'yi tüm tablolarda etkinleştir
ALTER TABLE public.profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages   ENABLE ROW LEVEL SECURITY;

-- ---- PROFILES ----

-- Kullanıcı yalnızca kendi profilini okuyabilir
CREATE POLICY "profiles: owner can select"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

-- Kullanıcı yalnızca kendi profilini güncelleyebilir
CREATE POLICY "profiles: owner can update"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);


-- ---- PROJECTS ----

-- Kullanıcı yalnızca kendi projelerini okuyabilir
CREATE POLICY "projects: owner can select"
    ON public.projects FOR SELECT
    USING (auth.uid() = user_id);

-- Kullanıcı yalnızca kendi adına proje oluşturabilir
CREATE POLICY "projects: owner can insert"
    ON public.projects FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Kullanıcı yalnızca kendi projelerini güncelleyebilir
CREATE POLICY "projects: owner can update"
    ON public.projects FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Kullanıcı yalnızca kendi projelerini silebilir
CREATE POLICY "projects: owner can delete"
    ON public.projects FOR DELETE
    USING (auth.uid() = user_id);


-- ---- INTERVIEWS ----

-- Kullanıcı kendi projelerine ait mülakatları okuyabilir
CREATE POLICY "interviews: owner can select"
    ON public.interviews FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_id
              AND p.user_id = auth.uid()
        )
    );

-- Kullanıcı kendi projelerine mülakat ekleyebilir
CREATE POLICY "interviews: owner can insert"
    ON public.interviews FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_id
              AND p.user_id = auth.uid()
        )
    );

-- Kullanıcı kendi projelerindeki mülakatları güncelleyebilir
CREATE POLICY "interviews: owner can update"
    ON public.interviews FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_id
              AND p.user_id = auth.uid()
        )
    );

-- Kullanıcı kendi projelerindeki mülakatları silebilir
CREATE POLICY "interviews: owner can delete"
    ON public.interviews FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_id
              AND p.user_id = auth.uid()
        )
    );

-- Public interview erişimi: katılımcı, yalnızca kendi interview_id'siyle
-- mesaj gönderebilir/okuyabilir (uygulama katmanında interview_id token ile doğrulanır)
-- Bu politika anon rol için açılabilir; şu an yalnızca authenticated kullanıcılara açık.
-- İleride anon erişim gerekirse aşağıdaki politika uncomment edilmeli ve
-- interview_id için ayrı bir token/slug mekanizması eklenmelidir.
--
-- CREATE POLICY "interviews: anon participant can select by id"
--     ON public.interviews FOR SELECT
--     TO anon
--     USING (true);  -- uygulama katmanında interview_id ile daraltılacak


-- ---- MESSAGES ----

-- Kullanıcı kendi projelerindeki mülakatların mesajlarını okuyabilir
CREATE POLICY "messages: owner can select"
    ON public.messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM   public.interviews i
            JOIN   public.projects   p ON p.id = i.project_id
            WHERE  i.id     = interview_id
              AND  p.user_id = auth.uid()
        )
    );

-- Mesaj ekleme: authenticated kullanıcı (proje sahibi) veya agent role'ü
CREATE POLICY "messages: owner can insert"
    ON public.messages FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM   public.interviews i
            JOIN   public.projects   p ON p.id = i.project_id
            WHERE  i.id     = interview_id
              AND  p.user_id = auth.uid()
        )
    );

-- Public (anon) mesaj ekleme: katılımcı kendi mülakat oturumuna mesaj gönderebilir.
-- interview_id doğrulaması uygulama katmanında yapılır (Route Handler üzerinden).
-- Doğrudan tablo erişimi kapalı tutulmak istenirse bu politikayı kaldırıp
-- yalnızca service_role ile yazma yapın.
CREATE POLICY "messages: anon participant can insert"
    ON public.messages FOR INSERT
    TO anon
    WITH CHECK (true);


-- =============================================================================
-- SCRIPT TAMAMLANDI
-- Tabloları doğrulamak için:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public';
-- =============================================================================
