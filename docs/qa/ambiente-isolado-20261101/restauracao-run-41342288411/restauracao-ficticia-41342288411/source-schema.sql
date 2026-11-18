--
-- PostgreSQL database dump
--

\restrict lEj89PqkwhJtrjZiv3o8MhK0BiO2jVXvg83H9SrdfR1BodZIM6s8fw4UjpcTJXs

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA auth;


ALTER SCHEMA auth OWNER TO supabase_admin;

--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA extensions;


ALTER SCHEMA extensions OWNER TO postgres;

--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA storage;


ALTER SCHEMA storage OWNER TO supabase_admin;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


ALTER TYPE auth.aal_level OWNER TO supabase_auth_admin;

--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


ALTER TYPE auth.code_challenge_method OWNER TO supabase_auth_admin;

--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


ALTER TYPE auth.factor_status OWNER TO supabase_auth_admin;

--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone',
    'recovery_code'
);


ALTER TYPE auth.factor_type OWNER TO supabase_auth_admin;

--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


ALTER TYPE auth.oauth_authorization_status OWNER TO supabase_auth_admin;

--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


ALTER TYPE auth.oauth_client_type OWNER TO supabase_auth_admin;

--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


ALTER TYPE auth.oauth_registration_type OWNER TO supabase_auth_admin;

--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


ALTER TYPE auth.oauth_response_type OWNER TO supabase_auth_admin;

--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


ALTER TYPE auth.one_time_token_type OWNER TO supabase_auth_admin;

--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


ALTER TYPE storage.buckettype OWNER TO supabase_storage_admin;

--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


ALTER FUNCTION auth.email() OWNER TO supabase_auth_admin;

--
-- Name: FUNCTION email(); Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;

--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;

--
-- Name: FUNCTION role(); Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;

--
-- Name: FUNCTION uid(); Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
    revoke trigger on cron.job_run_details from postgres cascade;
  END IF;
END;
$$;


ALTER FUNCTION extensions.grant_pg_cron_access() OWNER TO supabase_admin;

--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
begin
    if not exists (
        select 1
        from pg_event_trigger_ddl_commands() ev
        join pg_catalog.pg_extension e on ev.objid = e.oid
        where e.extname = 'pg_graphql'
    ) then
        return;
    end if;

    drop function if exists graphql_public.graphql;
    create or replace function graphql_public.graphql(
        "operationName" text default null,
        query text default null,
        variables jsonb default null,
        extensions jsonb default null
    )
        returns jsonb
        language sql
    as $$
        select graphql.resolve(
            query := query,
            variables := coalesce(variables, '{}'),
            "operationName" := "operationName",
            extensions := extensions
        );
    $$;

    -- Attach the wrapper to the extension so DROP EXTENSION cascades to it,
    -- which in turn triggers set_graphql_placeholder to reinstall the "not enabled" stub.
    alter extension pg_graphql add function graphql_public.graphql(text, text, jsonb, jsonb);

    grant usage on schema graphql to postgres, anon, authenticated, service_role;
    grant execute on function graphql.resolve to postgres, anon, authenticated, service_role;
    grant usage on schema graphql to postgres with grant option;
    grant usage on schema graphql_public to postgres with grant option;
end;
$_$;


ALTER FUNCTION extensions.grant_pg_graphql_access() OWNER TO supabase_admin;

--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


ALTER FUNCTION extensions.grant_pg_net_access() OWNER TO supabase_admin;

--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  cmd record;
  obj_schema text;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    -- triggers and rules have no schema of their own (schema_name is NULL),
    -- so use the schema of the table they belong to
    obj_schema := CASE
      WHEN cmd.object_type IN ('trigger', 'rule')
        THEN (pg_identify_object_as_address(cmd.classid, cmd.objid, cmd.objsubid)).object_names[1]
      ELSE cmd.schema_name
    END;

    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    -- also exclude any objects inside Supabase schemas
    AND COALESCE(obj_schema, '') NOT IN ('pg_temp', 'auth', 'realtime', '_realtime', 'storage')
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


ALTER FUNCTION extensions.pgrst_ddl_watch() OWNER TO supabase_admin;

--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  obj record;
  obj_schema text;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    -- triggers and rules have no schema of their own (schema_name is NULL),
    -- so use the schema of the table they belonged to
    obj_schema := CASE
      WHEN obj.object_type IN ('trigger', 'rule') THEN obj.address_names[1]
      ELSE obj.schema_name
    END;

    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    -- also exclude any objects inside Supabase schemas
    AND COALESCE(obj_schema, '') NOT IN ('pg_temp', 'auth', 'realtime', '_realtime', 'storage')
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


ALTER FUNCTION extensions.pgrst_drop_watch() OWNER TO supabase_admin;

--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


ALTER FUNCTION extensions.set_graphql_placeholder() OWNER TO supabase_admin;

--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: aceitar_convite_empresa_operacao(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.aceitar_convite_empresa_operacao(p_token uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare v_convite public.operacao_convites_empresa; v_usuario uuid := auth.uid();
  v_email text; v_empresa public.operacao_empresas;
begin
  if v_usuario is null then raise exception 'Faça login para aceitar o convite'; end if;
  select * into v_convite from public.operacao_convites_empresa
    where token = p_token for update;
  if not found or v_convite.revogado_em is not null or v_convite.expira_em <= now()
    or v_convite.aceito_em is not null then raise exception 'Convite inválido ou expirado'; end if;
  select lower(email) into v_email from auth.users where id = v_usuario;
  if v_email is distinct from v_convite.email then raise exception 'Entre com o e-mail indicado no convite'; end if;
  if exists (select 1 from public.operacao_organizacoes where owner_id = v_usuario)
    or exists (select 1 from public.operacao_membros where usuario_id = v_usuario) then
    raise exception 'Esta conta já gerencia uma operação. Use um e-mail próprio para este acesso restrito';
  end if;
  select * into v_empresa from public.operacao_empresas where id = v_convite.empresa_id and ativo = true;
  if not found then raise exception 'Empresa indisponível'; end if;
  insert into public.operacao_membros (organizacao_id, usuario_id, papel, empresa_id)
    values (v_convite.organizacao_id, v_usuario, 'operador', v_convite.empresa_id);
  update public.clientes set status = 'aprovado', nome = v_convite.nome,
    empresa = v_empresa.razao_social, cnpj = v_empresa.cnpj
    where id = v_usuario;
  if not found then raise exception 'Cadastro do usuário ainda não está disponível'; end if;
  update public.operacao_convites_empresa set aceito_em = now() where id = v_convite.id;
  return jsonb_build_object('empresa', v_empresa.razao_social, 'empresa_id', v_empresa.id);
end;
$$;


ALTER FUNCTION public.aceitar_convite_empresa_operacao(p_token uuid) OWNER TO supabase_admin;

--
-- Name: acesso_arquivo_operacao(text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.acesso_arquivo_operacao(p_caminho text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  partes text[] := string_to_array(p_caminho, '/');
begin
  if array_length(partes, 1) < 3 then return false; end if;
  return public.pode_acessar_empresa_operacao(partes[1]::uuid, partes[2]::uuid);
exception when invalid_text_representation then return false;
end;
$$;


ALTER FUNCTION public.acesso_arquivo_operacao(p_caminho text) OWNER TO supabase_admin;

--
-- Name: arquivo_no_escopo_operacao(text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.arquivo_no_escopo_operacao(p_caminho text, p_org uuid, p_empresa uuid) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
 select p_caminho is null or (p_caminho like p_org::text||'/'||p_empresa::text||'/%'
  and length(split_part(p_caminho,'/',3))>0);
$$;


ALTER FUNCTION public.arquivo_no_escopo_operacao(p_caminho text, p_org uuid, p_empresa uuid) OWNER TO supabase_admin;

--
-- Name: bootstrap_operacao(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.bootstrap_operacao() RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_usuario uuid := auth.uid(); v_org uuid; v_nome text; v_cnpj text;
begin
  if v_usuario is null then raise exception 'Sessão inválida'; end if;
  if not exists (select 1 from public.clientes c
    where c.id = v_usuario and c.status = 'aprovado') then
    raise exception 'Cadastro sem acesso ativo';
  end if;
  select id into v_org from public.operacao_organizacoes where owner_id = v_usuario;
  if v_org is not null then return v_org; end if;
  select organizacao_id into v_org from public.operacao_membros
    where usuario_id = v_usuario order by criado_em limit 1;
  if v_org is not null then return v_org; end if;
  if exists (select 1 from public.operacao_convites_empresa i
    join auth.users u on lower(u.email) = i.email
    where u.id = v_usuario and i.aceito_em is null and i.revogado_em is null
      and i.expira_em > now()) then
    raise exception 'Aceite o convite recebido antes de abrir a Central Operacional';
  end if;
  select coalesce(nullif(empresa, ''), nullif(nome, ''), 'Minha operação'), cnpj
    into v_nome, v_cnpj from public.clientes where id = v_usuario;
  insert into public.operacao_organizacoes (nome, owner_id)
    values (coalesce(v_nome, 'Minha operação'), v_usuario) returning id into v_org;
  insert into public.operacao_membros (organizacao_id, usuario_id, papel)
    values (v_org, v_usuario, 'gestor');
  insert into public.operacao_empresas (organizacao_id, razao_social, cnpj)
    values (v_org, coalesce(v_nome, 'Minha empresa'), nullif(v_cnpj, ''));
  return v_org;
end;
$$;


ALTER FUNCTION public.bootstrap_operacao() OWNER TO supabase_admin;

--
-- Name: configurar_limite_cnpjs_cliente(uuid, integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.configurar_limite_cnpjs_cliente(p_usuario_id uuid, p_limite integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then
    raise exception 'Apenas o proprietário administrativo pode configurar cotas';
  end if;
  if p_limite is null or p_limite not between 1 and 3 then
    raise exception 'O limite de clientes deve ser de 1 a 3 CNPJs';
  end if;
  if not exists (select 1 from public.clientes where id = p_usuario_id) then
    raise exception 'Cliente não encontrado';
  end if;
  if public.eh_owner_admin_operacao(p_usuario_id) then
    raise exception 'O proprietário administrativo tem cota ilimitada';
  end if;
  insert into public.operacao_limites_cnpj (usuario_id, limite, atualizado_em)
    values (p_usuario_id, p_limite, now())
    on conflict (usuario_id) do update set limite = excluded.limite, atualizado_em = now();
  return p_limite;
end;
$$;


ALTER FUNCTION public.configurar_limite_cnpjs_cliente(p_usuario_id uuid, p_limite integer) OWNER TO supabase_admin;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: operacao_identificacao_empresa; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_identificacao_empresa (
    empresa_id uuid NOT NULL,
    organizacao_id uuid NOT NULL,
    dados_confirmados jsonb NOT NULL,
    proveniencia jsonb DEFAULT '[]'::jsonb NOT NULL,
    confirmado_por uuid NOT NULL,
    confirmado_em timestamp with time zone DEFAULT now() NOT NULL,
    versao bigint DEFAULT 1 NOT NULL,
    invalidado_em timestamp with time zone,
    CONSTRAINT operacao_identificacao_empresa_dados_confirmados_check CHECK ((jsonb_typeof(dados_confirmados) = 'object'::text)),
    CONSTRAINT operacao_identificacao_empresa_proveniencia_check CHECK ((jsonb_typeof(proveniencia) = 'array'::text))
);


ALTER TABLE public.operacao_identificacao_empresa OWNER TO supabase_admin;

--
-- Name: confirmar_identificacao_empresa(uuid, uuid, text, text, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.confirmar_identificacao_empresa(p_empresa uuid, p_usuario uuid, p_razao text, p_cnpj text, p_dados jsonb, p_proveniencia jsonb) RETURNS public.operacao_identificacao_empresa
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare e public.operacao_empresas; r public.operacao_identificacao_empresa; x jsonb;
begin
 select * into e from public.operacao_empresas where id=p_empresa for update;
 if e.id is null or not exists(select 1 from public.operacao_membros m where m.organizacao_id=e.organizacao_id and m.usuario_id=p_usuario and m.papel in ('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id)) then raise exception 'Empresa indisponível'; end if;
 if e.razao_social<>p_razao or regexp_replace(e.cnpj,'\D','','g')<>regexp_replace(p_cnpj,'\D','','g') then raise exception 'Cadastro divergente'; end if;
 if jsonb_typeof(p_dados)<>'object' or (p_dados - array['endereco','representante','cargo'])<>'{}'::jsonb or jsonb_typeof(p_proveniencia)<>'array' or jsonb_array_length(p_proveniencia)>3 or (select count(distinct entrada.valor->>'documentoId') from jsonb_array_elements(p_proveniencia) as entrada(valor))>2 then raise exception 'Dados inválidos'; end if;
 if p_dados->>'endereco' is null or p_dados->>'representante' is null or p_dados->>'cargo' is null or length(trim(p_dados->>'endereco')) not between 1 and 500 or length(trim(p_dados->>'representante')) not between 1 and 180 or length(trim(p_dados->>'cargo')) not between 1 and 120 then raise exception 'Dados incompletos'; end if;
 for x in select * from jsonb_array_elements(p_proveniencia) loop
 if not exists(select 1 from public.operacao_documentos d where d.id=(x->>'documentoId')::uuid and d.empresa_id=e.id and d.organizacao_id=e.organizacao_id and d.arquivo_caminho=x->>'arquivoCaminho' and d.arquivo_caminho like e.organizacao_id::text||'/'||e.id::text||'/%') or coalesce(x->>'hash','') !~ '^[a-f0-9]{64}$' then raise exception 'Documento inválido'; end if;
 end loop;
 insert into public.operacao_identificacao_empresa(empresa_id,organizacao_id,dados_confirmados,proveniencia,confirmado_por) values(e.id,e.organizacao_id,p_dados,p_proveniencia,p_usuario)
 on conflict(empresa_id) do update set dados_confirmados=excluded.dados_confirmados,proveniencia=excluded.proveniencia,confirmado_por=excluded.confirmado_por,confirmado_em=now(),invalidado_em=null,versao=operacao_identificacao_empresa.versao+1 returning * into r;
 return r;
end $_$;


ALTER FUNCTION public.confirmar_identificacao_empresa(p_empresa uuid, p_usuario uuid, p_razao text, p_cnpj text, p_dados jsonb, p_proveniencia jsonb) OWNER TO supabase_admin;

--
-- Name: consultar_limite_cnpjs_cliente(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.consultar_limite_cnpjs_cliente(p_usuario_id uuid) RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_limite integer;
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then
    raise exception 'Apenas o proprietário administrativo pode configurar cotas';
  end if;
  if public.eh_owner_admin_operacao(p_usuario_id) then
    return null;
  end if;
  select limite into v_limite from public.operacao_limites_cnpj where usuario_id = p_usuario_id;
  return coalesce(v_limite, 3);
end;
$$;


ALTER FUNCTION public.consultar_limite_cnpjs_cliente(p_usuario_id uuid) OWNER TO supabase_admin;

--
-- Name: criar_cliente_no_cadastro(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.criar_cliente_no_cadastro() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  aprovacao_automatica boolean;
begin
  select coalesce((dado->>'aprovacao_automatica')::boolean, false)
    into aprovacao_automatica
    from public.dados_robo
    where chave = 'config_admin';

  insert into public.clientes (
    id, nome, empresa, cnpj, telefone, email, segmento, cargo, porte_empresa,
    aceite_termos, aceite_termos_em,
    atividades, estados_interesse, como_conheceu, quantidade_funcionarios,
    licitacoes_por_mes, faturamento_anual, como_pretende_usar,
    status, aprovado_em, aprovado_por
  ) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    new.raw_user_meta_data->>'empresa',
    new.raw_user_meta_data->>'cnpj',
    new.raw_user_meta_data->>'telefone',
    new.email,
    coalesce(new.raw_user_meta_data->'segmento', '[]'::jsonb),
    new.raw_user_meta_data->>'cargo',
    new.raw_user_meta_data->>'porte_empresa',
    coalesce((new.raw_user_meta_data->>'aceite_termos')::boolean, false),
    case when (new.raw_user_meta_data->>'aceite_termos') = 'true' then now() else null end,
    new.raw_user_meta_data->>'atividades',
    coalesce(new.raw_user_meta_data->'estados_interesse', '[]'::jsonb),
    new.raw_user_meta_data->>'como_conheceu',
    new.raw_user_meta_data->>'quantidade_funcionarios',
    new.raw_user_meta_data->>'licitacoes_por_mes',
    new.raw_user_meta_data->>'faturamento_anual',
    new.raw_user_meta_data->>'como_pretende_usar',
    case when aprovacao_automatica then 'aprovado' else 'pendente' end,
    case when aprovacao_automatica then now() else null end,
    case when aprovacao_automatica then 'automatico' else null end
  );
  return new;
end;
$$;


ALTER FUNCTION public.criar_cliente_no_cadastro() OWNER TO supabase_admin;

--
-- Name: criar_convite_empresa_operacao(uuid, text, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.criar_convite_empresa_operacao(p_empresa_id uuid, p_email text, p_nome text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare v_convite public.operacao_convites_empresa; v_org uuid;
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if;
  if p_email is null or p_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'E-mail inválido'; end if;
  if length(trim(coalesce(p_nome,''))) < 2 then raise exception 'Informe o nome da pessoa'; end if;
  select e.organizacao_id into v_org from public.operacao_empresas e
    where e.id = p_empresa_id and e.ativo = true;
  if v_org is null then raise exception 'Empresa não encontrada'; end if;
  -- Não reaproveita convite para outra empresa e não altera acesso sem aviso.
  insert into public.operacao_convites_empresa (organizacao_id, empresa_id, email, nome, criado_por)
    values (v_org, p_empresa_id, lower(trim(p_email)), trim(p_nome), auth.uid())
    returning * into v_convite;
  return jsonb_build_object('id', v_convite.id, 'token', v_convite.token,
    'expira_em', v_convite.expira_em);
end;
$_$;


ALTER FUNCTION public.criar_convite_empresa_operacao(p_empresa_id uuid, p_email text, p_nome text) OWNER TO supabase_admin;

--
-- Name: dashboard_estados_distintos(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.dashboard_estados_distintos() RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select count(distinct nullif(uf, ''))::integer from public.contratos;
$$;


ALTER FUNCTION public.dashboard_estados_distintos() OWNER TO supabase_admin;

--
-- Name: dashboard_estados_top(integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.dashboard_estados_top(limite integer DEFAULT 10) RETURNS TABLE(uf text, total bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select c.uf, count(*) as total
  from public.contratos c
  where nullif(c.uf, '') is not null
  group by c.uf
  order by total desc, c.uf
  limit greatest(1, least(coalesce(limite, 10), 100));
$$;


ALTER FUNCTION public.dashboard_estados_top(limite integer) OWNER TO supabase_admin;

--
-- Name: dashboard_segmentos_top(integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.dashboard_segmentos_top(limite integer DEFAULT 10) RETURNS TABLE(segmento text, total bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select s.segmento, count(*) as total
  from public.contratos c
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(c.dado -> 'segmentos') = 'array'
      then c.dado -> 'segmentos' else '[]'::jsonb end
  ) as s(segmento)
  where nullif(s.segmento, '') is not null
  group by s.segmento
  order by total desc, s.segmento
  limit greatest(1, least(coalesce(limite, 10), 100));
$$;


ALTER FUNCTION public.dashboard_segmentos_top(limite integer) OWNER TO supabase_admin;

--
-- Name: eh_membro_operacao(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.eh_membro_operacao(p_organizacao_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.operacao_membros m
    where m.organizacao_id = p_organizacao_id and m.usuario_id = auth.uid()
      and m.empresa_id is null);
$$;


ALTER FUNCTION public.eh_membro_operacao(p_organizacao_id uuid) OWNER TO supabase_admin;

--
-- Name: eh_owner_admin_operacao(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.eh_owner_admin_operacao(p_usuario_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from auth.users u
      join public.admins a on lower(a.email) = lower(u.email)
    where u.id = p_usuario_id and a.role = 'owner'
  );
$$;


ALTER FUNCTION public.eh_owner_admin_operacao(p_usuario_id uuid) OWNER TO supabase_admin;

--
-- Name: escrita_arquivo_operacao(text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.escrita_arquivo_operacao(p_caminho text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if coalesce(array_length(string_to_array(p_caminho,'/'),1),0)<3 or length(split_part(p_caminho,'/',3))=0 then return false; end if;
 return public.pode_escrever_empresa_operacao(split_part(p_caminho,'/',1)::uuid,split_part(p_caminho,'/',2)::uuid);
exception when invalid_text_representation then return false;
end $$;


ALTER FUNCTION public.escrita_arquivo_operacao(p_caminho text) OWNER TO supabase_admin;

--
-- Name: operacao_kit_documentos; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_kit_documentos (
    id uuid NOT NULL,
    organizacao_id uuid NOT NULL,
    empresa_id uuid NOT NULL,
    processo_id uuid NOT NULL,
    tipo text NOT NULL,
    dados jsonb NOT NULL,
    versao integer DEFAULT 1 NOT NULL,
    criado_por uuid NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_por uuid NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    revisao_hash text,
    revisao_previa jsonb,
    revisao_versao integer,
    revisado_por uuid,
    revisado_em timestamp with time zone,
    CONSTRAINT operacao_kit_documentos_check CHECK ((((revisao_hash IS NULL) AND (revisao_previa IS NULL) AND (revisao_versao IS NULL) AND (revisado_por IS NULL) AND (revisado_em IS NULL)) OR ((revisao_hash IS NOT NULL) AND (revisao_hash ~ '^[a-f0-9]{64}$'::text) AND (revisao_previa IS NOT NULL) AND (jsonb_typeof(revisao_previa) = 'object'::text) AND (revisao_versao IS NOT NULL) AND (revisao_versao = versao) AND (revisado_por IS NOT NULL) AND (revisado_em IS NOT NULL)))),
    CONSTRAINT operacao_kit_documentos_dados_check CHECK ((jsonb_typeof(dados) = 'object'::text)),
    CONSTRAINT operacao_kit_documentos_tipo_check CHECK ((tipo = ANY (ARRAY['declaracao'::text, 'proposta'::text]))),
    CONSTRAINT operacao_kit_documentos_versao_check CHECK ((versao > 0))
);


ALTER TABLE public.operacao_kit_documentos OWNER TO supabase_admin;

--
-- Name: gravar_kit_documento(uuid, uuid, uuid, uuid, uuid, integer, text, text, jsonb, text, jsonb); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.gravar_kit_documento(p_documento uuid, p_empresa uuid, p_processo uuid, p_organizacao uuid, p_usuario uuid, p_versao integer, p_tipo text, p_acao text, p_dados jsonb, p_hash text DEFAULT NULL::text, p_previa jsonb DEFAULT NULL::jsonb) RETURNS public.operacao_kit_documentos
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $_$
declare d public.operacao_kit_documentos;v jsonb;x record;item_id text;limite integer;
begin
 if p_documento is null or p_usuario is null or p_versao is null or p_versao<0 or p_versao>2147483646
  or p_tipo is null or p_tipo not in ('declaracao','proposta') or p_acao is null or p_acao not in ('salvar','confirmarRevisao')
 then raise sqlstate 'PT400' using message='Solicitação inválida';end if;
 if not exists(select 1 from public.clientes c join public.operacao_membros m on m.usuario_id=c.id
  join public.operacao_empresas e on e.organizacao_id=m.organizacao_id
  where c.id=p_usuario and c.status='aprovado' and m.papel in ('gestor','operador')
   and e.ativo and e.id=p_empresa and e.organizacao_id=p_organizacao and (m.empresa_id is null or m.empresa_id=e.id))
 then raise sqlstate 'PT403' using message='Acesso não autorizado';end if;
 if not exists(select 1 from public.operacao_processos p where p.id=p_processo and p.empresa_id=p_empresa and p.organizacao_id=p_organizacao)
 then raise sqlstate 'PT404' using message='Processo indisponível';end if;

 if p_dados is null or jsonb_typeof(p_dados)<>'object' or p_dados-array[p_tipo]<>'{}'::jsonb or jsonb_typeof(p_dados->p_tipo) is distinct from 'object' or length(p_dados::text)>50000
 then raise sqlstate 'PT400' using message='Dados inválidos';end if;
 v:=p_dados->p_tipo;
 if (p_tipo='declaracao' and v-array['titulo','texto','fonte']<>'{}'::jsonb)
  or (p_tipo='proposta' and v-array['itemIds','unidades','validade','prazoEntrega','pagamento']<>'{}'::jsonb)
 then raise sqlstate 'PT400' using message='Campo não permitido';end if;
 for x in select key,value from jsonb_each(v) where key not in ('itemIds','unidades') loop
  limite:=case x.key when 'titulo' then 180 when 'texto' then 20000 when 'fonte' then 1000 else 500 end;
  if jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>limite or regexp_replace(x.value#>>'{}',E'[\t\n\r]','','g') ~ '[[:cntrl:]]'
  then raise sqlstate 'PT400' using message='Texto inválido';end if;
 end loop;
 if p_tipo='proposta' then
  if (v?'itemIds' and jsonb_typeof(v->'itemIds')<>'array') or (v?'unidades' and jsonb_typeof(v->'unidades')<>'object')
  then raise sqlstate 'PT400' using message='Itens e unidades inválidos';end if;
  if jsonb_array_length(coalesce(v->'itemIds','[]'))>50
  or (select count(*)<>count(distinct lower(value#>>'{}')) from jsonb_array_elements(coalesce(v->'itemIds','[]')))
  then raise sqlstate 'PT400' using message='Itens duplicados ou excessivos';end if;
  for x in select value from jsonb_array_elements(coalesce(v->'itemIds','[]')) loop
   item_id:=x.value#>>'{}';
   if jsonb_typeof(x.value)<>'string' or item_id !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
   then raise sqlstate 'PT400' using message='Item inválido';end if;
   if not exists(select 1 from public.operacao_itens_resultado i where i.id=item_id::uuid and i.processo_id=p_processo and i.organizacao_id=p_organizacao)
   then raise sqlstate 'PT404' using message='Item indisponível';end if;
  end loop;
  for x in select key,value from jsonb_each(coalesce(v->'unidades','{}')) loop
   if not (coalesce(v->'itemIds','[]') ? x.key) or jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>40 or regexp_replace(x.value#>>'{}',E'[\t\n\r]','','g') ~ '[[:cntrl:]]'
   then raise sqlstate 'PT400' using message='Unidade inválida';end if;
  end loop;
 end if;

 if p_acao='salvar' and p_versao=0 then
  insert into public.operacao_kit_documentos(id,organizacao_id,empresa_id,processo_id,tipo,dados,criado_por,atualizado_por)
   values(p_documento,p_organizacao,p_empresa,p_processo,p_tipo,p_dados,p_usuario,p_usuario)
   on conflict(id) do nothing returning * into d;
  if d.id is not null then return d;end if;
 end if;
 select * into d from public.operacao_kit_documentos where id=p_documento for update;
 if d.id is null then raise sqlstate 'PT404' using message='Documento indisponível';end if;
 if d.organizacao_id<>p_organizacao or d.empresa_id<>p_empresa or d.processo_id<>p_processo or d.tipo<>p_tipo
 then raise sqlstate 'PT409' using message='Escopo ou tipo divergente';end if;
 -- A mesma intenção só é recuperável antes da primeira edição e pelo seu autor.
 if p_acao='salvar' and p_versao=0 and d.versao=1 and d.criado_por=p_usuario and d.dados=p_dados then return d;end if;
 if d.versao<>p_versao then raise sqlstate 'PT409' using message='Versão alterada';end if;
 if p_acao='salvar' then
  update public.operacao_kit_documentos set dados=p_dados,versao=versao+1,atualizado_por=p_usuario,atualizado_em=clock_timestamp(),
   revisao_hash=null,revisao_previa=null,revisao_versao=null,revisado_por=null,revisado_em=null
   where id=p_documento and versao=p_versao returning * into d;
 else
  if d.dados<>p_dados then raise sqlstate 'PT409' using message='Dados alterados';end if;
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_previa is null or jsonb_typeof(p_previa)<>'object'
   or p_previa-array['texto','fontes']<>'{}'::jsonb or jsonb_typeof(p_previa->'texto') is distinct from 'string'
   or length(p_previa->>'texto') not between 1 and 1000000 or jsonb_typeof(p_previa->'fontes') is distinct from 'array'
  then raise sqlstate 'PT400' using message='Revisão inválida';end if;
  if jsonb_array_length(p_previa->'fontes')>10 or exists(select 1 from jsonb_array_elements(p_previa->'fontes') f where jsonb_typeof(f)<>'string' or length(f#>>'{}')>2000)
  then raise sqlstate 'PT400' using message='Fontes da revisão inválidas';end if;
  update public.operacao_kit_documentos set revisao_hash=p_hash,revisao_previa=p_previa,revisao_versao=versao,revisado_por=p_usuario,revisado_em=clock_timestamp()
   where id=p_documento and versao=p_versao returning * into d;
 end if;
 if d.id is null then raise sqlstate 'PT409' using message='Versão alterada';end if;
 return d;
end $_$;


ALTER FUNCTION public.gravar_kit_documento(p_documento uuid, p_empresa uuid, p_processo uuid, p_organizacao uuid, p_usuario uuid, p_versao integer, p_tipo text, p_acao text, p_dados jsonb, p_hash text, p_previa jsonb) OWNER TO supabase_admin;

--
-- Name: identificacao_empresa_habilitada(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.identificacao_empresa_habilitada() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
 with esperado(tabela,nome,comando,qual,checagem) as (values
 ('operacao_empresas','operacao_empresas_leitura','SELECT','pode_acessar_empresa_operacao(organizacao_id, id)',null),
 ('operacao_empresas','operacao_empresas_escrita','ALL','pode_escrever_org_operacao(organizacao_id)','pode_escrever_org_operacao(organizacao_id)'),
 ('operacao_documentos','operacao_documentos_da_empresa','SELECT','pode_acessar_empresa_operacao(organizacao_id, empresa_id)',null),
 ('operacao_documentos','operacao_documentos_da_empresa_escrita','ALL','pode_escrever_empresa_operacao(organizacao_id, empresa_id)','(pode_escrever_empresa_operacao(organizacao_id, empresa_id) AND arquivo_no_escopo_operacao(arquivo_caminho, organizacao_id, empresa_id))'),
 ('objects','operacao_arquivos_leitura','SELECT','((bucket_id = ''operacao-documentos''::text) AND acesso_arquivo_operacao(name))',null),
 ('objects','operacao_arquivos_envio','INSERT',null,'((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))'),
 ('objects','operacao_arquivos_atualizacao','UPDATE','((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))','((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))'),
 ('objects','operacao_arquivos_exclusao','DELETE','((bucket_id = ''operacao-documentos''::text) AND escrita_arquivo_operacao(name))',null)
 ), atual as (select * from pg_policies where (schemaname='public' and tablename in ('operacao_documentos','operacao_empresas')) or (schemaname='storage' and tablename='objects'))
 select auth.uid() is not null
 and exists(select 1 from storage.buckets where id='operacao-documentos' and public=false)
 and exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relname='objects' and c.relrowsecurity)
 and (select count(*)=3 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('operacao_empresas','operacao_documentos','operacao_identificacao_empresa') and c.relrowsecurity)
 and not exists(select 1 from esperado e full join atual a on a.tablename=e.tabela and a.policyname=e.nome
  where e.nome is null or a.policyname is null or a.cmd<>e.comando or a.permissive<>'PERMISSIVE'
   or a.qual is distinct from e.qual or a.with_check is distinct from e.checagem
   or a.roles is distinct from case when e.nome in ('operacao_empresas_leitura','operacao_arquivos_leitura') then array['public']::name[] else array['authenticated']::name[] end)
 and not exists(select 1 from (values
 ('pode_escrever_org_operacao','c5fa4a20c0df119753f8f2efd99b4264'),
 ('pode_escrever_empresa_operacao','c5e91057ee05d745a22bd2fc89c80322'),
 ('pode_escrever_processo_operacao','7de47c8d343558a2dc2180ad2a4daffc'),
 ('arquivo_no_escopo_operacao','c727f040598b92b257a5322118447d6f'),
 ('escrita_arquivo_operacao','d95ab917f9d1faf6270e16d85dda42fd')
 ) as f(nome,hash) where not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f.nome and md5(replace(p.prosrc,chr(13),''))=f.hash));
$$;


ALTER FUNCTION public.identificacao_empresa_habilitada() OWNER TO supabase_admin;

--
-- Name: incrementar_uso(uuid, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.incrementar_uso(p_usuario_id uuid, p_funcao text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  nova_contagem integer;
begin
  insert into public.uso_diario (usuario_id, funcao, dia, contagem)
  values (p_usuario_id, p_funcao, current_date, 1)
  on conflict (usuario_id, funcao, dia)
  do update set contagem = public.uso_diario.contagem + 1
  returning contagem into nova_contagem;

  return nova_contagem;
end;
$$;


ALTER FUNCTION public.incrementar_uso(p_usuario_id uuid, p_funcao text) OWNER TO supabase_admin;

--
-- Name: invalidar_identificacao_empresa(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.invalidar_identificacao_empresa() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
 if TG_TABLE_SCHEMA='storage' then
 update public.operacao_identificacao_empresa p set invalidado_em=now() where exists(select 1 from jsonb_array_elements(p.proveniencia) x where x->>'arquivoCaminho'=old.name);
 elsif TG_TABLE_NAME='operacao_empresas' then
 if old.razao_social is distinct from new.razao_social or old.cnpj is distinct from new.cnpj then update public.operacao_identificacao_empresa set invalidado_em=now() where empresa_id=old.id; end if;
 else
 update public.operacao_identificacao_empresa p set invalidado_em=now() where exists(select 1 from jsonb_array_elements(p.proveniencia) x where x->>'documentoId'=old.id::text);
 end if; return null;
end $$;


ALTER FUNCTION public.invalidar_identificacao_empresa() OWNER TO supabase_admin;

--
-- Name: kit_documento_escopo_imutavel(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.kit_documento_escopo_imutavel() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'pg_temp'
    AS $$
begin
 if row(new.id,new.organizacao_id,new.empresa_id,new.processo_id,new.tipo,new.criado_por,new.criado_em)
  is distinct from row(old.id,old.organizacao_id,old.empresa_id,old.processo_id,old.tipo,old.criado_por,old.criado_em)
 then raise sqlstate 'PT409' using message='Escopo e autoria da peça são imutáveis';end if;
 return new;
end $$;


ALTER FUNCTION public.kit_documento_escopo_imutavel() OWNER TO supabase_admin;

--
-- Name: limite_cnpjs_operacao(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.limite_cnpjs_operacao() RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_usuario uuid := auth.uid();
  v_limite integer;
begin
  if v_usuario is null then raise exception 'Sessão inválida'; end if;
  if public.eh_owner_admin_operacao(v_usuario) then
    return null; -- NULL representa cota ilimitada somente para o owner administrativo.
  end if;
  select limite into v_limite from public.operacao_limites_cnpj where usuario_id = v_usuario;
  return coalesce(v_limite, 3);
end;
$$;


ALTER FUNCTION public.limite_cnpjs_operacao() OWNER TO supabase_admin;

--
-- Name: listar_acessos_empresa_operacao(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.listar_acessos_empresa_operacao() RETURNS TABLE(usuario_id uuid, email text, nome text, empresa text, empresa_id uuid)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if;
  return query select m.usuario_id, u.email::text, c.nome, e.razao_social, e.id
    from public.operacao_membros m join public.operacao_empresas e on e.id = m.empresa_id
    join auth.users u on u.id = m.usuario_id
    left join public.clientes c on c.id = m.usuario_id
    where m.empresa_id is not null order by e.razao_social, u.email;
end;
$$;


ALTER FUNCTION public.listar_acessos_empresa_operacao() OWNER TO supabase_admin;

--
-- Name: listar_convites_empresa_operacao(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.listar_convites_empresa_operacao() RETURNS TABLE(id uuid, email text, nome text, empresa text, expira_em timestamp with time zone, aceito_em timestamp with time zone, revogado_em timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if;
  return query select c.id, c.email, c.nome, e.razao_social, c.expira_em, c.aceito_em, c.revogado_em
    from public.operacao_convites_empresa c join public.operacao_empresas e on e.id = c.empresa_id
    order by c.criado_em desc limit 100;
end;
$$;


ALTER FUNCTION public.listar_convites_empresa_operacao() OWNER TO supabase_admin;

--
-- Name: listar_empresas_convite_operacao(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.listar_empresas_convite_operacao() RETURNS TABLE(id uuid, razao_social text, cnpj text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if;
  return query select e.id, e.razao_social, e.cnpj from public.operacao_empresas e
    where e.ativo = true order by e.razao_social;
end;
$$;


ALTER FUNCTION public.listar_empresas_convite_operacao() OWNER TO supabase_admin;

--
-- Name: meu_acesso_operacao(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.meu_acesso_operacao() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((select jsonb_build_object('organizacao_id', m.organizacao_id,
    'empresa_id', m.empresa_id, 'papel', m.papel)
    from public.operacao_membros m where m.usuario_id = auth.uid()
    order by (m.empresa_id is null) desc, m.criado_em limit 1), '{}'::jsonb);
$$;


ALTER FUNCTION public.meu_acesso_operacao() OWNER TO supabase_admin;

--
-- Name: oportunidades_para_dossies(integer, integer, date, date, integer); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.oportunidades_para_dossies(p_versao integer, p_max_tentativas integer, p_desde date, p_hoje date, p_limite integer DEFAULT 200) RETURNS TABLE(numero_controle_pncp text, publicacao date, encerramento date)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  with filtros as materialized (
    select distinct
      array(select jsonb_array_elements_text(c.boletim_filtro->'ufs')) as ufs,
      array(select regexp_replace(normalize(lower(btrim(palavra)), NFKD), U&'[\0300-\036f]', '', 'g')
        from regexp_split_to_table(c.boletim_filtro->>'palavrasRaw', ',') palavra
        where btrim(palavra) <> '') as palavras
    from public.clientes c
    where c.status = 'aprovado' and c.boletim_filtro is not null
  )
  select o.numero_controle_pncp, o.publicacao, o.encerramento
  from filtros f cross join lateral (
    select a.numero_controle_pncp, a.publicacao, a.encerramento
    from public.oportunidades_abertas a
    where a.numero_controle_pncp is not null
      and a.publicacao >= p_desde
      and (a.encerramento is null or a.encerramento >= p_hoje)
      and (cardinality(f.ufs) = 0 or a.uf = any(f.ufs))
      and exists (
        select 1 from unnest(f.palavras) palavra where strpos(
          regexp_replace(normalize(lower(a.objeto), NFKD), U&'[\0300-\036f]', '', 'g'), palavra
        ) > 0
      )
      and not exists (
      select 1 from public.dossies_editais d
      where d.numero_controle_pncp = a.numero_controle_pncp and d.versao = p_versao and d.status = 'pronto'
    )
      and not exists (
      select 1 from public.fila_dossies fila
      where fila.numero_controle_pncp = a.numero_controle_pncp and fila.tentativas >= p_max_tentativas
    )
    order by a.publicacao desc, a.numero_controle_pncp
    limit greatest(0, least(coalesce(p_limite, 200), 200))
  ) o
  group by o.numero_controle_pncp, o.publicacao, o.encerramento
  order by o.publicacao desc, o.numero_controle_pncp
  limit greatest(0, least(coalesce(p_limite, 200), 200));
$$;


ALTER FUNCTION public.oportunidades_para_dossies(p_versao integer, p_max_tentativas integer, p_desde date, p_hoje date, p_limite integer) OWNER TO supabase_admin;

--
-- Name: pode_acessar_empresa_operacao(uuid, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.pode_acessar_empresa_operacao(p_org uuid, p_empresa uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.operacao_empresas e
    join public.operacao_membros m on m.organizacao_id = e.organizacao_id
    where e.id = p_empresa and e.organizacao_id = p_org and m.usuario_id = auth.uid()
      and (m.empresa_id is null or m.empresa_id = e.id));
$$;


ALTER FUNCTION public.pode_acessar_empresa_operacao(p_org uuid, p_empresa uuid) OWNER TO supabase_admin;

--
-- Name: pode_acessar_processo_operacao(uuid, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.pode_acessar_processo_operacao(p_org uuid, p_processo uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.operacao_processos p
    where p.id = p_processo and p.organizacao_id = p_org
      and public.pode_acessar_empresa_operacao(p.organizacao_id, p.empresa_id));
$$;


ALTER FUNCTION public.pode_acessar_processo_operacao(p_org uuid, p_processo uuid) OWNER TO supabase_admin;

--
-- Name: pode_escrever_empresa_operacao(uuid, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.pode_escrever_empresa_operacao(p_org uuid, p_empresa uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 select exists(select 1 from public.operacao_empresas e join public.operacao_membros m on m.organizacao_id=e.organizacao_id
  where e.id=p_empresa and e.organizacao_id=p_org and m.usuario_id=auth.uid()
  and m.papel in ('gestor','operador') and (m.empresa_id is null or m.empresa_id=e.id));
$$;


ALTER FUNCTION public.pode_escrever_empresa_operacao(p_org uuid, p_empresa uuid) OWNER TO supabase_admin;

--
-- Name: pode_escrever_org_operacao(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.pode_escrever_org_operacao(p_org uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 select exists(select 1 from public.operacao_membros m where m.organizacao_id=p_org
  and m.usuario_id=auth.uid() and m.empresa_id is null and m.papel in ('gestor','operador'));
$$;


ALTER FUNCTION public.pode_escrever_org_operacao(p_org uuid) OWNER TO supabase_admin;

--
-- Name: pode_escrever_processo_operacao(uuid, uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.pode_escrever_processo_operacao(p_org uuid, p_processo uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
 select exists(select 1 from public.operacao_processos p where p.id=p_processo and p.organizacao_id=p_org
  and public.pode_escrever_empresa_operacao(p.organizacao_id,p.empresa_id));
$$;


ALTER FUNCTION public.pode_escrever_processo_operacao(p_org uuid, p_processo uuid) OWNER TO supabase_admin;

--
-- Name: preservar_escopo_operacao(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.preservar_escopo_operacao() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
 if old.organizacao_id is distinct from new.organizacao_id or old.empresa_id is distinct from new.empresa_id then
 raise exception 'Escopo não pode ser transferido; crie um novo documento ou processo no CNPJ correto';
 end if;
 return new;
end $$;


ALTER FUNCTION public.preservar_escopo_operacao() OWNER TO supabase_admin;

--
-- Name: proteger_status_cliente_operacao(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.proteger_status_cliente_operacao() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then return new; end if;
  end if;
  if auth.uid() is not null and auth.uid() = new.id
    and new.status = 'aprovado'
    and not public.eh_owner_admin_operacao(auth.uid())
    and not exists (select 1 from public.operacao_membros m
      where m.usuario_id = auth.uid() and m.empresa_id is not null) then
    raise exception 'A aprovação do cadastro depende do administrador';
  end if;
  return new;
end;
$$;


ALTER FUNCTION public.proteger_status_cliente_operacao() OWNER TO supabase_admin;

--
-- Name: resumo_inteligencia_mercado(text[], integer, text); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.resumo_inteligencia_mercado(p_termos text[], p_dias integer, p_uf text DEFAULT NULL::text) RETURNS TABLE(valor_nacional numeric, valor_recorte numeric, contratos_recorte bigint, concorrentes_recorte bigint, orgaos_recorte bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with base as (
    select
      c.uf,
      c.cnpj_fornecedor,
      coalesce(c.dado ->> 'orgao', 'Órgão não informado') as orgao,
      coalesce(nullif(c.dado ->> 'valor', '')::numeric, 0) as valor
    from public.contratos c
    where (p_dias is null or p_dias <= 0 or c.data_assinatura >= current_date - p_dias or c.data_assinatura is null)
      and (
        coalesce(cardinality(p_termos), 0) = 0
        or exists (
          select 1 from unnest(p_termos) as termo
          where c.objeto ilike '%' || termo || '%'
        )
      )
  ), recorte as (
    select * from base where p_uf is null or uf = p_uf
  )
  select
    coalesce((select sum(valor) from base), 0),
    coalesce((select sum(valor) from recorte), 0),
    (select count(*) from recorte),
    (select count(distinct nullif(cnpj_fornecedor, '')) from recorte),
    (select count(distinct orgao) from recorte);
$$;


ALTER FUNCTION public.resumo_inteligencia_mercado(p_termos text[], p_dias integer, p_uf text) OWNER TO supabase_admin;

--
-- Name: revogar_acesso_empresa_operacao(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.revogar_acesso_empresa_operacao(p_usuario_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if;
  delete from public.operacao_membros where usuario_id = p_usuario_id and empresa_id is not null;
  if not found then return false; end if;
  -- Além da RLS, a guarda de login do site rejeita a conta imediatamente.
  update public.clientes set status = 'rejeitado' where id = p_usuario_id;
  return true;
end;
$$;


ALTER FUNCTION public.revogar_acesso_empresa_operacao(p_usuario_id uuid) OWNER TO supabase_admin;

--
-- Name: revogar_convite_empresa_operacao(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.revogar_convite_empresa_operacao(p_convite_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if;
  update public.operacao_convites_empresa set revogado_em = now()
    where id = p_convite_id and aceito_em is null and revogado_em is null;
  return found;
end;
$$;


ALTER FUNCTION public.revogar_convite_empresa_operacao(p_convite_id uuid) OWNER TO supabase_admin;

--
-- Name: tem_vinculo_operacao(uuid); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.tem_vinculo_operacao(p_organizacao_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (select 1 from public.operacao_membros m
    where m.organizacao_id = p_organizacao_id and m.usuario_id = auth.uid());
$$;


ALTER FUNCTION public.tem_vinculo_operacao(p_organizacao_id uuid) OWNER TO supabase_admin;

--
-- Name: validar_arquivo_processo_operacao(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.validar_arquivo_processo_operacao() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
 if not exists(select 1 from public.operacao_processos p where p.id=new.processo_id and p.organizacao_id=new.organizacao_id and public.arquivo_no_escopo_operacao(new.arquivo_caminho,p.organizacao_id,p.empresa_id)) then
 raise exception 'Arquivo fora do escopo do processo';
 end if;
 return new;
end $$;


ALTER FUNCTION public.validar_arquivo_processo_operacao() OWNER TO supabase_admin;

--
-- Name: verificar_limite_cnpjs_operacao(); Type: FUNCTION; Schema: public; Owner: supabase_admin
--

CREATE FUNCTION public.verificar_limite_cnpjs_operacao() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_owner uuid;
  v_limite integer;
  v_total integer;
begin
  if not new.ativo then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.ativo and old.organizacao_id = new.organizacao_id then
      return new;
    end if;
  end if;
  -- O bloqueio na organização serializa dois cadastros simultâneos.
  select owner_id into v_owner from public.operacao_organizacoes
    where id = new.organizacao_id for update;
  if v_owner is null then raise exception 'Organização não encontrada'; end if;
  if public.eh_owner_admin_operacao(v_owner) then
    return new;
  end if;
  select coalesce((select limite from public.operacao_limites_cnpj where usuario_id = v_owner), 3)
    into v_limite;
  select count(*) into v_total from public.operacao_empresas
    where organizacao_id = new.organizacao_id and ativo = true;
  if v_total >= v_limite then
    raise exception 'Limite de % CNPJs ativos atingido para esta conta', v_limite
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;


ALTER FUNCTION public.verificar_limite_cnpjs_operacao() OWNER TO supabase_admin;

--
-- Name: allow_any_operation(text[]); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.allow_any_operation(expected_operations text[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$$;


ALTER FUNCTION storage.allow_any_operation(expected_operations text[]) OWNER TO supabase_storage_admin;

--
-- Name: allow_only_operation(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.allow_only_operation(expected_operation text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$$;


ALTER FUNCTION storage.allow_only_operation(expected_operation text) OWNER TO supabase_storage_admin;

--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


ALTER FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) OWNER TO supabase_storage_admin;

--
-- Name: enforce_bucket_lifecycle_service_role(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.enforce_bucket_lifecycle_service_role() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
BEGIN
  IF current_user::text IS DISTINCT FROM TG_ARGV[0]
     AND (
       OLD.lifecycle_configuration IS DISTINCT FROM NEW.lifecycle_configuration
       OR OLD.lifecycle_configuration_generation IS DISTINCT FROM NEW.lifecycle_configuration_generation
     ) THEN
    -- AFTER runs only after caller RLS has accepted the proposed row. The API
    -- recognizes this specific error after rolling back its permission probe;
    -- direct non-service writes still fail and cannot persist the change.
    RAISE EXCEPTION 'bucket control columns may only be changed by the configured storage service role'
      USING ERRCODE = 'PST01',
            SCHEMA = TG_TABLE_SCHEMA,
            TABLE = TG_TABLE_NAME,
            CONSTRAINT = TG_NAME;
  END IF;

  RETURN NULL;
END;
$$;


ALTER FUNCTION storage.enforce_bucket_lifecycle_service_role() OWNER TO supabase_storage_admin;

--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


ALTER FUNCTION storage.enforce_bucket_name_length() OWNER TO supabase_storage_admin;

--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Get the last path segment (the actual filename)
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    -- Extract extension: reverse, split on '.', then reverse again
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


ALTER FUNCTION storage.extension(name text) OWNER TO supabase_storage_admin;

--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    RETURN _parts[array_length(_parts, 1)];
END
$$;


ALTER FUNCTION storage.filename(name text) OWNER TO supabase_storage_admin;

--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


ALTER FUNCTION storage.foldername(name text) OWNER TO supabase_storage_admin;

--
-- Name: get_common_prefix(text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$$;


ALTER FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) OWNER TO supabase_storage_admin;

--
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.get_size_by_bucket() RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint)::bigint as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


ALTER FUNCTION storage.get_size_by_bucket() OWNER TO supabase_storage_admin;

--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


ALTER FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer, next_key_token text, next_upload_token text) OWNER TO supabase_storage_admin;

--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer, start_after text, next_token text, sort_order text) OWNER TO supabase_storage_admin;

--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


ALTER FUNCTION storage.operation() OWNER TO supabase_storage_admin;

--
-- Name: protect_bucket_control_columns(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.protect_bucket_control_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  configuration_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_configuration IS NOT NULL
       OR NEW.lifecycle_configuration_generation IS NOT NULL THEN
      IF NOT pg_has_role(current_user, TG_ARGV[0], 'MEMBER') THEN
        RAISE EXCEPTION 'only members of the configured storage service role may insert lifecycle policy state'
          USING ERRCODE = '42501',
                HINT = format(
                  'Insert with both lifecycle columns NULL and configure lifecycle through the Storage API afterward, or insert as a member of %I.',
                  TG_ARGV[0]
                );
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  configuration_changed =
    OLD.lifecycle_configuration IS DISTINCT FROM NEW.lifecycle_configuration
    OR OLD.lifecycle_configuration_generation IS DISTINCT FROM NEW.lifecycle_configuration_generation;

  IF NOT configuration_changed THEN
    RETURN NEW;
  END IF;

  IF NEW.type IS DISTINCT FROM 'STANDARD' THEN
    RAISE EXCEPTION 'bucket versioning and lifecycle controls require a Standard bucket'
      USING ERRCODE = '0A000';
  END IF;

  IF NEW.lifecycle_configuration IS NULL
     AND NEW.lifecycle_configuration_generation IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.lifecycle_configuration IS NULL
     OR NEW.lifecycle_configuration_generation IS NULL
     OR OLD.lifecycle_configuration IS NOT DISTINCT FROM NEW.lifecycle_configuration
     OR OLD.lifecycle_configuration_generation IS NOT DISTINCT FROM NEW.lifecycle_configuration_generation THEN
    RAISE EXCEPTION 'a changed lifecycle policy requires a new non-null generation'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION storage.protect_bucket_control_columns() OWNER TO supabase_storage_admin;

--
-- Name: protect_delete(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.protect_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION storage.protect_delete() OWNER TO supabase_storage_admin;

--
-- Name: search(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_prefix_len INT;
    v_prefix_start INT;
    v_combined_levels INT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_prefix_len := length(coalesce(prefix, ''));
    v_prefix_start := coalesce(array_length(string_to_array(coalesce(prefix, ''), v_delimiter), 1), 1);
    v_combined_levels := coalesce(array_length(string_to_array(v_prefix, v_delimiter), 1), 1);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT array_to_string(path_tokens[$1:$2], '/') AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $3 || '%%'
                  AND bucket_id = $4
                  AND array_length(objects.path_tokens, 1) <> $2
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT array_to_string(path_tokens[$1:$2], '/') AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $3 || '%%'
               AND bucket_id = $4
               AND array_length(objects.path_tokens, 1) = $2
             ORDER BY %I %s)
            LIMIT $5 OFFSET $6
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING v_prefix_start, v_combined_levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := substring(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter) from v_prefix_len + 1);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := substring(v_current.name from v_prefix_len + 1);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION storage.search(prefix text, bucketname text, limits integer, levels integer, offsets integer, search text, sortcolumn text, sortorder text) OWNER TO supabase_storage_admin;

--
-- Name: search_by_timestamp(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
    v_sort_order text;
    v_sort_column text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    -- Defense-in-depth: this function is independently reachable and must
    -- not trust p_sort_order/p_sort_column to already be validated by a
    -- caller. Normalize to the same strict allow-list storage.search_v2
    -- uses before interpolating anything into dynamic SQL below.
    v_sort_order := lower(coalesce(p_sort_order, 'asc'));
    IF v_sort_order NOT IN ('asc', 'desc') THEN
        v_sort_order := 'asc';
    END IF;

    v_sort_column := lower(coalesce(p_sort_column, 'updated_at'));
    IF v_sort_column NOT IN ('updated_at', 'created_at') THEN
        v_sort_column := 'updated_at';
    END IF;

    IF v_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        v_sort_column,
        v_cursor_op,
        v_sort_column,
        v_sort_order,
        v_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$_$;


ALTER FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) OWNER TO supabase_storage_admin;

--
-- Name: search_v2(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$$;


ALTER FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer, levels integer, start_after text, sort_order text, sort_column text, sort_column_after text) OWNER TO supabase_storage_admin;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


ALTER FUNCTION storage.update_updated_at_column() OWNER TO supabase_storage_admin;

--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


ALTER TABLE auth.audit_log_entries OWNER TO supabase_auth_admin;

--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.custom_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pkce_enabled boolean DEFAULT true NOT NULL,
    attribute_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    email_optional boolean DEFAULT false NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean DEFAULT false NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    custom_claims_allowlist text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT custom_oauth_providers_authorization_url_https CHECK (((authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_authorization_url_length CHECK (((authorization_url IS NULL) OR (char_length(authorization_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_client_id_length CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 512))),
    CONSTRAINT custom_oauth_providers_discovery_url_length CHECK (((discovery_url IS NULL) OR (char_length(discovery_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_identifier_format CHECK ((identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text)),
    CONSTRAINT custom_oauth_providers_issuer_length CHECK (((issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048)))),
    CONSTRAINT custom_oauth_providers_jwks_uri_https CHECK (((jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_jwks_uri_length CHECK (((jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048))),
    CONSTRAINT custom_oauth_providers_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints CHECK (((provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL)))),
    CONSTRAINT custom_oauth_providers_oidc_discovery_url_https CHECK (((provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_issuer_https CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_requires_issuer CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NOT NULL))),
    CONSTRAINT custom_oauth_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]))),
    CONSTRAINT custom_oauth_providers_token_url_https CHECK (((token_url IS NULL) OR (token_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_token_url_length CHECK (((token_url IS NULL) OR (char_length(token_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_userinfo_url_https CHECK (((userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_userinfo_url_length CHECK (((userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)))
);


ALTER TABLE auth.custom_oauth_providers OWNER TO supabase_auth_admin;

--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


ALTER TABLE auth.flow_state OWNER TO supabase_auth_admin;

--
-- Name: TABLE flow_state; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


ALTER TABLE auth.identities OWNER TO supabase_auth_admin;

--
-- Name: TABLE identities; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN identities.email; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


ALTER TABLE auth.instances OWNER TO supabase_auth_admin;

--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


ALTER TABLE auth.mfa_amr_claims OWNER TO supabase_auth_admin;

--
-- Name: TABLE mfa_amr_claims; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


ALTER TABLE auth.mfa_challenges OWNER TO supabase_auth_admin;

--
-- Name: TABLE mfa_challenges; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


ALTER TABLE auth.mfa_factors OWNER TO supabase_auth_admin;

--
-- Name: TABLE mfa_factors; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';


--
-- Name: COLUMN mfa_factors.last_webauthn_challenge_data; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';


--
-- Name: mfa_recovery_code_sets; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.mfa_recovery_code_sets (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    mfa_factor_id uuid NOT NULL,
    failed_verification_count integer DEFAULT 0 NOT NULL,
    verification_locked_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mfa_recovery_code_sets_failed_verification_count_check CHECK ((failed_verification_count >= 0))
);


ALTER TABLE auth.mfa_recovery_code_sets OWNER TO supabase_auth_admin;

--
-- Name: mfa_recovery_codes; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.mfa_recovery_codes (
    id uuid NOT NULL,
    mfa_recovery_code_set_id uuid NOT NULL,
    code_hash text NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE auth.mfa_recovery_codes OWNER TO supabase_auth_admin;

--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


ALTER TABLE auth.oauth_authorizations OWNER TO supabase_auth_admin;

--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


ALTER TABLE auth.oauth_client_states OWNER TO supabase_auth_admin;

--
-- Name: TABLE oauth_client_states; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


ALTER TABLE auth.oauth_clients OWNER TO supabase_auth_admin;

--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


ALTER TABLE auth.oauth_consents OWNER TO supabase_auth_admin;

--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


ALTER TABLE auth.one_time_tokens OWNER TO supabase_auth_admin;

--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


ALTER TABLE auth.refresh_tokens OWNER TO supabase_auth_admin;

--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: supabase_auth_admin
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE auth.refresh_tokens_id_seq OWNER TO supabase_auth_admin;

--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: supabase_auth_admin
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


ALTER TABLE auth.saml_providers OWNER TO supabase_auth_admin;

--
-- Name: TABLE saml_providers; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


ALTER TABLE auth.saml_relay_states OWNER TO supabase_auth_admin;

--
-- Name: TABLE saml_relay_states; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


ALTER TABLE auth.schema_migrations OWNER TO supabase_auth_admin;

--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: scim_tokens; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.scim_tokens (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    token_hash text NOT NULL,
    prefix text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone,
    CONSTRAINT scim_tokens_expires_at_future CHECK (((expires_at IS NULL) OR (expires_at > created_at))),
    CONSTRAINT scim_tokens_revoked_after_created CHECK (((revoked_at IS NULL) OR (revoked_at >= created_at))),
    CONSTRAINT scim_tokens_token_hash_check CHECK ((token_hash ~ '^[0-9a-f]{64}$'::text))
);


ALTER TABLE auth.scim_tokens OWNER TO supabase_auth_admin;

--
-- Name: scim_users; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.scim_users (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    user_id uuid,
    resource jsonb NOT NULL,
    user_name text GENERATED ALWAYS AS (lower((resource ->> 'userName'::text))) STORED NOT NULL,
    external_id text GENERATED ALWAYS AS ((resource ->> 'externalId'::text)) STORED,
    active boolean GENERATED ALWAYS AS (COALESCE(((resource ->> 'active'::text))::boolean, true)) STORED NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE auth.scim_users OWNER TO supabase_auth_admin;

--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


ALTER TABLE auth.sessions OWNER TO supabase_auth_admin;

--
-- Name: TABLE sessions; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN sessions.not_after; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: COLUMN sessions.refresh_token_hmac_key; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';


--
-- Name: COLUMN sessions.refresh_token_counter; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


ALTER TABLE auth.sso_domains OWNER TO supabase_auth_admin;

--
-- Name: TABLE sso_domains; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


ALTER TABLE auth.sso_providers OWNER TO supabase_auth_admin;

--
-- Name: TABLE sso_providers; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN sso_providers.resource_id; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


ALTER TABLE auth.users OWNER TO supabase_auth_admin;

--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN users.is_sso_user; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: webauthn_challenges; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge_type text NOT NULL,
    session_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT webauthn_challenges_challenge_type_check CHECK ((challenge_type = ANY (ARRAY['signup'::text, 'registration'::text, 'authentication'::text])))
);


ALTER TABLE auth.webauthn_challenges OWNER TO supabase_auth_admin;

--
-- Name: webauthn_credentials; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    attestation_type text DEFAULT ''::text NOT NULL,
    aaguid uuid,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports jsonb DEFAULT '[]'::jsonb NOT NULL,
    backup_eligible boolean DEFAULT false NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    friendly_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


ALTER TABLE auth.webauthn_credentials OWNER TO supabase_auth_admin;

--
-- Name: admins; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.admins (
    email text NOT NULL,
    nome text,
    role text DEFAULT 'membro'::text NOT NULL,
    permissoes text[] DEFAULT '{}'::text[] NOT NULL,
    criado_por text,
    criado_em timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.admins OWNER TO supabase_admin;

--
-- Name: clientes; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.clientes (
    id uuid NOT NULL,
    nome text DEFAULT ''::text NOT NULL,
    empresa text,
    cnpj text,
    telefone text,
    email text,
    segmento jsonb DEFAULT '[]'::jsonb NOT NULL,
    cargo text,
    porte_empresa text,
    aceite_termos boolean DEFAULT false NOT NULL,
    aceite_termos_em timestamp with time zone,
    status text DEFAULT 'pendente'::text NOT NULL,
    aprovado_em timestamp with time zone,
    aprovado_por text,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    plano text,
    observacoes_admin text,
    atividades text,
    estados_interesse jsonb DEFAULT '[]'::jsonb NOT NULL,
    como_conheceu text,
    quantidade_funcionarios text,
    licitacoes_por_mes text,
    faturamento_anual text,
    como_pretende_usar text,
    boletim_filtro jsonb,
    CONSTRAINT clientes_boletim_filtro_valido CHECK (((boletim_filtro IS NULL) OR ((jsonb_typeof(boletim_filtro) = 'object'::text) AND (jsonb_typeof((boletim_filtro -> 'ufs'::text)) = 'array'::text) AND (jsonb_typeof((boletim_filtro -> 'palavrasRaw'::text)) = 'string'::text) AND (jsonb_array_length((boletim_filtro -> 'ufs'::text)) <= 27) AND ((length(btrim((boletim_filtro ->> 'palavrasRaw'::text))) >= 1) AND (length(btrim((boletim_filtro ->> 'palavrasRaw'::text))) <= 1000)) AND (octet_length((boletim_filtro)::text) <= 4000) AND (boletim_filtro ?& ARRAY['ufs'::text, 'palavrasRaw'::text]))))
);


ALTER TABLE public.clientes OWNER TO supabase_admin;

--
-- Name: comprasgov_resultados; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.comprasgov_resultados (
    chave text NOT NULL,
    id_compra_item text NOT NULL,
    id_compra text,
    numero_controle_pncp text,
    descricao_item text DEFAULT ''::text NOT NULL,
    uf text,
    cnpj_fornecedor text,
    data_resultado date,
    dado jsonb NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.comprasgov_resultados OWNER TO supabase_admin;

--
-- Name: contratos; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.contratos (
    numero_controle_pncp text NOT NULL,
    objeto text DEFAULT ''::text NOT NULL,
    uf text,
    cnpj_fornecedor text,
    data_assinatura date,
    dado jsonb NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.contratos OWNER TO supabase_admin;

--
-- Name: dados_robo; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.dados_robo (
    chave text NOT NULL,
    dado jsonb NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.dados_robo OWNER TO supabase_admin;

--
-- Name: dossies_editais; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.dossies_editais (
    numero_controle_pncp text NOT NULL,
    versao integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'processando'::text NOT NULL,
    fonte_lida boolean DEFAULT false NOT NULL,
    dossie jsonb DEFAULT '{}'::jsonb NOT NULL,
    gerado_em timestamp with time zone,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    expira_em timestamp with time zone,
    CONSTRAINT dossies_editais_status_check CHECK ((status = ANY (ARRAY['processando'::text, 'pronto'::text, 'parcial'::text, 'erro'::text])))
);


ALTER TABLE public.dossies_editais OWNER TO supabase_admin;

--
-- Name: fila_dossies; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.fila_dossies (
    numero_controle_pncp text NOT NULL,
    origem text DEFAULT 'clique'::text NOT NULL,
    pedido_em timestamp with time zone DEFAULT now() NOT NULL,
    tentativas integer DEFAULT 0 NOT NULL,
    ultima_tentativa_em timestamp with time zone,
    ultimo_erro text,
    concluido_em timestamp with time zone,
    CONSTRAINT fila_dossies_origem_check CHECK ((origem = ANY (ARRAY['clique'::text, 'boletim'::text])))
);


ALTER TABLE public.fila_dossies OWNER TO supabase_admin;

--
-- Name: lembretes; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.lembretes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cliente_id uuid NOT NULL,
    numero_controle_pncp text,
    objeto_resumo text,
    data_final_proposta timestamp with time zone,
    dias_antes integer,
    nota text,
    enviado boolean DEFAULT false NOT NULL
);


ALTER TABLE public.lembretes OWNER TO supabase_admin;

--
-- Name: logs_boletim; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.logs_boletim (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cliente_id uuid,
    cliente_email text,
    cliente_nome text,
    status text,
    quantidade_editais integer,
    mensagem_erro text,
    executado_em timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.logs_boletim OWNER TO supabase_admin;

--
-- Name: mercado_atas; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.mercado_atas (
    numero_controle_pncp_ata text NOT NULL,
    numero_controle_pncp_compra text,
    objeto text DEFAULT ''::text NOT NULL,
    uf_orgao text,
    municipio_orgao text,
    segmentos text[] DEFAULT '{}'::text[] NOT NULL,
    data_assinatura date,
    vigencia_fim date,
    cancelado boolean DEFAULT false NOT NULL,
    enriquecida boolean DEFAULT false NOT NULL,
    dado jsonb NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.mercado_atas OWNER TO supabase_admin;

--
-- Name: operacao_agenda; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_agenda (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    empresa_id uuid,
    categoria text NOT NULL,
    titulo text NOT NULL,
    vencimento timestamp with time zone NOT NULL,
    responsavel text,
    observacoes text,
    concluido_em timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operacao_agenda_categoria_check CHECK ((categoria = ANY (ARRAY['sessao'::text, 'esclarecimento'::text, 'impugnacao'::text, 'proposta'::text, 'diligencia'::text, 'recurso'::text, 'entrega'::text, 'vigencia'::text, 'reajuste'::text, 'repactuacao'::text, 'renovacao'::text, 'outro'::text])))
);


ALTER TABLE public.operacao_agenda OWNER TO supabase_admin;

--
-- Name: operacao_anexos_processo; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_anexos_processo (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    processo_id uuid NOT NULL,
    tipo text NOT NULL,
    titulo text NOT NULL,
    referencia_numero text,
    arquivo_caminho text NOT NULL,
    arquivo_nome text NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operacao_anexos_processo_tipo_check CHECK ((tipo = ANY (ARRAY['edital'::text, 'proposta'::text, 'habilitacao'::text, 'homologacao'::text, 'contrato'::text, 'empenho'::text, 'ata'::text, 'outro'::text])))
);


ALTER TABLE public.operacao_anexos_processo OWNER TO supabase_admin;

--
-- Name: operacao_contratos; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_contratos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    processo_id uuid NOT NULL,
    numero text NOT NULL,
    assinado_em date,
    vigencia_inicio date,
    vigencia_fim date,
    valor numeric(15,2),
    situacao text DEFAULT 'a_assinar'::text NOT NULL,
    observacoes text,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operacao_contratos_situacao_check CHECK ((situacao = ANY (ARRAY['a_assinar'::text, 'vigente'::text, 'encerrado'::text, 'rescindido'::text]))),
    CONSTRAINT operacao_contratos_valor_check CHECK (((valor IS NULL) OR (valor >= (0)::numeric)))
);


ALTER TABLE public.operacao_contratos OWNER TO supabase_admin;

--
-- Name: operacao_convites_empresa; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_convites_empresa (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    empresa_id uuid NOT NULL,
    email text NOT NULL,
    nome text NOT NULL,
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    expira_em timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    aceito_em timestamp with time zone,
    revogado_em timestamp with time zone,
    criado_por uuid NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.operacao_convites_empresa OWNER TO supabase_admin;

--
-- Name: operacao_documentos; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_documentos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    empresa_id uuid NOT NULL,
    tipo text NOT NULL,
    titulo text,
    emissao date,
    vencimento date,
    orgao_emissor text,
    responsavel text,
    observacoes text,
    arquivo_caminho text,
    arquivo_nome text,
    criado_por uuid,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operacao_documentos_arquivo_escopo CHECK (public.arquivo_no_escopo_operacao(arquivo_caminho, organizacao_id, empresa_id))
);


ALTER TABLE public.operacao_documentos OWNER TO supabase_admin;

--
-- Name: operacao_empenhos; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_empenhos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    processo_id uuid NOT NULL,
    numero text NOT NULL,
    emitido_em date,
    valor numeric(15,2) DEFAULT 0 NOT NULL,
    saldo numeric(15,2),
    entrega_prevista date,
    entregue_em date,
    recebido_em date,
    pago_em date,
    status text DEFAULT 'emitido'::text NOT NULL,
    observacoes text,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operacao_empenhos_saldo_check CHECK (((saldo IS NULL) OR (saldo >= (0)::numeric))),
    CONSTRAINT operacao_empenhos_status_check CHECK ((status = ANY (ARRAY['emitido'::text, 'em_execucao'::text, 'entregue'::text, 'recebido'::text, 'pago'::text, 'cancelado'::text]))),
    CONSTRAINT operacao_empenhos_valor_check CHECK ((valor >= (0)::numeric))
);


ALTER TABLE public.operacao_empenhos OWNER TO supabase_admin;

--
-- Name: operacao_empresas; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_empresas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    razao_social text NOT NULL,
    cnpj text,
    responsavel text,
    ativo boolean DEFAULT true NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.operacao_empresas OWNER TO supabase_admin;

--
-- Name: operacao_itens_resultado; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_itens_resultado (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    processo_id uuid NOT NULL,
    identificador text NOT NULL,
    tipo text DEFAULT 'item'::text NOT NULL,
    descricao text,
    situacao text DEFAULT 'pendente'::text NOT NULL,
    quantidade numeric(15,3),
    valor_proposta numeric(15,2),
    valor_homologado numeric(15,2),
    motivo text,
    fonte_oficial text,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    marca text,
    modelo text,
    valor_unitario_proposta numeric(15,2),
    valor_unitario_homologado numeric(15,2),
    CONSTRAINT operacao_itens_resultado_check CHECK (((valor_homologado IS NULL) OR ((valor_homologado >= (0)::numeric) AND (situacao = 'ganho'::text)))),
    CONSTRAINT operacao_itens_resultado_check1 CHECK (((valor_unitario_homologado IS NULL) OR ((valor_unitario_homologado >= (0)::numeric) AND (situacao = 'ganho'::text)))),
    CONSTRAINT operacao_itens_resultado_quantidade_check CHECK (((quantidade IS NULL) OR (quantidade >= (0)::numeric))),
    CONSTRAINT operacao_itens_resultado_situacao_check CHECK ((situacao = ANY (ARRAY['pendente'::text, 'ganho'::text, 'perdido'::text, 'desclassificado'::text, 'inabilitado'::text, 'nao_disputado'::text, 'cancelado'::text]))),
    CONSTRAINT operacao_itens_resultado_tipo_check CHECK ((tipo = ANY (ARRAY['item'::text, 'lote'::text]))),
    CONSTRAINT operacao_itens_resultado_valor_proposta_check CHECK (((valor_proposta IS NULL) OR (valor_proposta >= (0)::numeric))),
    CONSTRAINT operacao_itens_resultado_valor_unitario_proposta_check CHECK (((valor_unitario_proposta IS NULL) OR (valor_unitario_proposta >= (0)::numeric)))
);


ALTER TABLE public.operacao_itens_resultado OWNER TO supabase_admin;

--
-- Name: operacao_limites_cnpj; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_limites_cnpj (
    usuario_id uuid NOT NULL,
    limite integer NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operacao_limites_cnpj_limite_check CHECK (((limite >= 1) AND (limite <= 3)))
);


ALTER TABLE public.operacao_limites_cnpj OWNER TO supabase_admin;

--
-- Name: operacao_membros; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_membros (
    organizacao_id uuid NOT NULL,
    usuario_id uuid NOT NULL,
    papel text DEFAULT 'gestor'::text NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    empresa_id uuid,
    CONSTRAINT operacao_membros_papel_check CHECK ((papel = ANY (ARRAY['gestor'::text, 'operador'::text, 'leitura'::text])))
);


ALTER TABLE public.operacao_membros OWNER TO supabase_admin;

--
-- Name: operacao_ocorrencias; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_ocorrencias (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    processo_id uuid NOT NULL,
    ocorrido_em timestamp with time zone NOT NULL,
    categoria text DEFAULT 'registro'::text NOT NULL,
    descricao text NOT NULL,
    fonte_oficial text,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operacao_ocorrencias_categoria_check CHECK ((categoria = ANY (ARRAY['registro'::text, 'sessao'::text, 'chat'::text, 'diligencia'::text, 'recurso'::text, 'resultado'::text, 'contrato'::text, 'execucao'::text])))
);


ALTER TABLE public.operacao_ocorrencias OWNER TO supabase_admin;

--
-- Name: operacao_organizacoes; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_organizacoes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nome text NOT NULL,
    owner_id uuid NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.operacao_organizacoes OWNER TO supabase_admin;

--
-- Name: operacao_prazos_processo; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_prazos_processo (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    processo_id uuid NOT NULL,
    categoria text NOT NULL,
    titulo text NOT NULL,
    vencimento timestamp with time zone NOT NULL,
    responsavel text,
    concluido_em timestamp with time zone,
    observacoes text,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operacao_prazos_processo_categoria_check CHECK ((categoria = ANY (ARRAY['esclarecimento'::text, 'impugnacao'::text, 'proposta'::text, 'sessao'::text, 'diligencia'::text, 'recurso'::text, 'assinatura'::text, 'entrega'::text, 'outro'::text])))
);


ALTER TABLE public.operacao_prazos_processo OWNER TO supabase_admin;

--
-- Name: operacao_processos; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_processos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid NOT NULL,
    empresa_id uuid NOT NULL,
    numero text,
    objeto text NOT NULL,
    orgao text,
    modalidade text,
    url_origem text,
    status text DEFAULT 'triagem'::text NOT NULL,
    decisao text DEFAULT 'em_analise'::text NOT NULL,
    responsavel text,
    valor_estimado numeric(15,2),
    custo_direto numeric(15,2),
    frete numeric(15,2),
    tributos_percentual numeric(7,3),
    garantia_percentual numeric(7,3),
    margem_percentual numeric(7,3),
    preco_minimo numeric(15,2),
    preco_proposta numeric(15,2),
    documentos_exigidos text[] DEFAULT '{}'::text[] NOT NULL,
    data_publicacao date,
    data_sessao timestamp with time zone,
    data_resultado date,
    resultado text,
    motivo_perda text,
    observacoes text,
    criado_por uuid,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
    origem_externa_id text,
    sistema text,
    uasg text,
    situacao_resultado text DEFAULT 'nao_apurado'::text NOT NULL,
    valor_homologado numeric(15,2),
    fonte_resultado text,
    checklist_fonte text DEFAULT 'manual'::text NOT NULL,
    checklist_editado_manualmente boolean DEFAULT false NOT NULL,
    checklist_gerado_em timestamp with time zone,
    CONSTRAINT operacao_processos_decisao_check CHECK ((decisao = ANY (ARRAY['em_analise'::text, 'participar'::text, 'nao_participar'::text]))),
    CONSTRAINT operacao_processos_resultado_valido CHECK ((situacao_resultado = ANY (ARRAY['nao_apurado'::text, 'nao_participou'::text, 'em_disputa'::text, 'sem_vitoria'::text, 'vitoria_sem_detalhamento'::text, 'vitoria_parcial'::text, 'vitoria_total'::text, 'revogado_anulado'::text]))),
    CONSTRAINT operacao_processos_status_check CHECK ((status = ANY (ARRAY['triagem'::text, 'preparacao'::text, 'proposta_enviada'::text, 'sessao'::text, 'habilitacao'::text, 'recurso'::text, 'homologado'::text, 'contratado'::text, 'perdido'::text, 'arquivado'::text]))),
    CONSTRAINT operacao_processos_valor_homologado_valido CHECK (((valor_homologado IS NULL) OR (valor_homologado >= (0)::numeric)))
);


ALTER TABLE public.operacao_processos OWNER TO supabase_admin;

--
-- Name: operacao_renovacoes_documento; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_renovacoes_documento (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    documento_id uuid NOT NULL,
    emissao_anterior date,
    vencimento_anterior date,
    emissao_nova date,
    vencimento_novo date,
    registrado_por uuid,
    registrado_em timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.operacao_renovacoes_documento OWNER TO supabase_admin;

--
-- Name: operacao_tipos_documento; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.operacao_tipos_documento (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organizacao_id uuid,
    nome text NOT NULL,
    personalizado boolean DEFAULT false NOT NULL
);


ALTER TABLE public.operacao_tipos_documento OWNER TO supabase_admin;

--
-- Name: oportunidades_abertas; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.oportunidades_abertas (
    chave text NOT NULL,
    numero_controle_pncp text,
    objeto text DEFAULT ''::text NOT NULL,
    uf text,
    publicacao date,
    encerramento date,
    dado jsonb NOT NULL,
    atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.oportunidades_abertas OWNER TO supabase_admin;

--
-- Name: uso_diario; Type: TABLE; Schema: public; Owner: supabase_admin
--

CREATE TABLE public.uso_diario (
    usuario_id uuid NOT NULL,
    funcao text NOT NULL,
    dia date DEFAULT CURRENT_DATE NOT NULL,
    contagem integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.uso_diario OWNER TO supabase_admin;

--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL,
    versioning_status text DEFAULT 'DISABLED'::text NOT NULL,
    lifecycle_configuration jsonb,
    lifecycle_configuration_generation uuid,
    CONSTRAINT buckets_lifecycle_configuration_pair_check CHECK (((lifecycle_configuration IS NULL) = (lifecycle_configuration_generation IS NULL))),
    CONSTRAINT buckets_lifecycle_configuration_shape_check CHECK (((lifecycle_configuration IS NULL) OR ((jsonb_typeof(lifecycle_configuration) = 'object'::text) AND (lifecycle_configuration ? 'rules'::text) AND
CASE
    WHEN (jsonb_typeof((lifecycle_configuration -> 'rules'::text)) = 'array'::text) THEN ((jsonb_array_length((lifecycle_configuration -> 'rules'::text)) >= 1) AND (jsonb_array_length((lifecycle_configuration -> 'rules'::text)) <= 1000))
    ELSE false
END))),
    CONSTRAINT buckets_lifecycle_configuration_standard_only_check CHECK (((type = 'STANDARD'::storage.buckettype) OR ((lifecycle_configuration IS NULL) AND (lifecycle_configuration_generation IS NULL)))),
    CONSTRAINT buckets_versioning_dark_check CHECK ((versioning_status = 'DISABLED'::text)),
    CONSTRAINT buckets_versioning_standard_only_check CHECK (((type = 'STANDARD'::storage.buckettype) OR (versioning_status = 'DISABLED'::text))),
    CONSTRAINT buckets_versioning_status_check CHECK ((versioning_status = ANY (ARRAY['DISABLED'::text, 'ENABLED'::text, 'SUSPENDED'::text])))
);


ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;

--
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: supabase_storage_admin
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE storage.buckets_analytics OWNER TO supabase_storage_admin;

--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE storage.buckets_vectors OWNER TO supabase_storage_admin;

--
-- Name: iceberg_namespaces; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.iceberg_namespaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_name text NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    catalog_id uuid NOT NULL
);


ALTER TABLE storage.iceberg_namespaces OWNER TO supabase_storage_admin;

--
-- Name: iceberg_tables; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.iceberg_tables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    namespace_id uuid NOT NULL,
    bucket_name text NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    location text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    remote_table_id text,
    shard_key text,
    shard_id text,
    catalog_id uuid NOT NULL
);


ALTER TABLE storage.iceberg_tables OWNER TO supabase_storage_admin;

--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE storage.migrations OWNER TO supabase_storage_admin;

--
-- Name: objects; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb,
    archived_at timestamp with time zone,
    is_delete_marker boolean DEFAULT false NOT NULL,
    is_versioned boolean DEFAULT false NOT NULL
);


ALTER TABLE storage.objects OWNER TO supabase_storage_admin;

--
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: supabase_storage_admin
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb,
    metadata jsonb
);


ALTER TABLE storage.s3_multipart_uploads OWNER TO supabase_storage_admin;

--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE storage.s3_multipart_uploads_parts OWNER TO supabase_storage_admin;

--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.vector_indexes (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE storage.vector_indexes OWNER TO supabase_storage_admin;

--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: mfa_recovery_code_sets mfa_recovery_code_sets_mfa_factor_id_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_recovery_code_sets
    ADD CONSTRAINT mfa_recovery_code_sets_mfa_factor_id_key UNIQUE (mfa_factor_id);


--
-- Name: mfa_recovery_code_sets mfa_recovery_code_sets_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_recovery_code_sets
    ADD CONSTRAINT mfa_recovery_code_sets_pkey PRIMARY KEY (id);


--
-- Name: mfa_recovery_code_sets mfa_recovery_code_sets_user_id_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_recovery_code_sets
    ADD CONSTRAINT mfa_recovery_code_sets_user_id_key UNIQUE (user_id);


--
-- Name: mfa_recovery_codes mfa_recovery_codes_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_recovery_codes
    ADD CONSTRAINT mfa_recovery_codes_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: scim_tokens scim_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.scim_tokens
    ADD CONSTRAINT scim_tokens_pkey PRIMARY KEY (id);


--
-- Name: scim_users scim_users_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.scim_users
    ADD CONSTRAINT scim_users_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (email);


--
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);


--
-- Name: comprasgov_resultados comprasgov_resultados_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.comprasgov_resultados
    ADD CONSTRAINT comprasgov_resultados_pkey PRIMARY KEY (chave);


--
-- Name: contratos contratos_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_pkey PRIMARY KEY (numero_controle_pncp);


--
-- Name: dados_robo dados_robo_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.dados_robo
    ADD CONSTRAINT dados_robo_pkey PRIMARY KEY (chave);


--
-- Name: dossies_editais dossies_editais_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.dossies_editais
    ADD CONSTRAINT dossies_editais_pkey PRIMARY KEY (numero_controle_pncp);


--
-- Name: fila_dossies fila_dossies_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.fila_dossies
    ADD CONSTRAINT fila_dossies_pkey PRIMARY KEY (numero_controle_pncp);


--
-- Name: lembretes lembretes_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.lembretes
    ADD CONSTRAINT lembretes_pkey PRIMARY KEY (id);


--
-- Name: logs_boletim logs_boletim_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.logs_boletim
    ADD CONSTRAINT logs_boletim_pkey PRIMARY KEY (id);


--
-- Name: mercado_atas mercado_atas_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.mercado_atas
    ADD CONSTRAINT mercado_atas_pkey PRIMARY KEY (numero_controle_pncp_ata);


--
-- Name: operacao_agenda operacao_agenda_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_agenda
    ADD CONSTRAINT operacao_agenda_pkey PRIMARY KEY (id);


--
-- Name: operacao_anexos_processo operacao_anexos_processo_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_anexos_processo
    ADD CONSTRAINT operacao_anexos_processo_pkey PRIMARY KEY (id);


--
-- Name: operacao_contratos operacao_contratos_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_contratos
    ADD CONSTRAINT operacao_contratos_pkey PRIMARY KEY (id);


--
-- Name: operacao_contratos operacao_contratos_processo_id_numero_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_contratos
    ADD CONSTRAINT operacao_contratos_processo_id_numero_key UNIQUE (processo_id, numero);


--
-- Name: operacao_convites_empresa operacao_convites_empresa_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_convites_empresa
    ADD CONSTRAINT operacao_convites_empresa_pkey PRIMARY KEY (id);


--
-- Name: operacao_convites_empresa operacao_convites_empresa_token_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_convites_empresa
    ADD CONSTRAINT operacao_convites_empresa_token_key UNIQUE (token);


--
-- Name: operacao_documentos operacao_documentos_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_documentos
    ADD CONSTRAINT operacao_documentos_pkey PRIMARY KEY (id);


--
-- Name: operacao_empenhos operacao_empenhos_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_empenhos
    ADD CONSTRAINT operacao_empenhos_pkey PRIMARY KEY (id);


--
-- Name: operacao_empenhos operacao_empenhos_processo_id_numero_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_empenhos
    ADD CONSTRAINT operacao_empenhos_processo_id_numero_key UNIQUE (processo_id, numero);


--
-- Name: operacao_empresas operacao_empresas_organizacao_id_cnpj_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_empresas
    ADD CONSTRAINT operacao_empresas_organizacao_id_cnpj_key UNIQUE (organizacao_id, cnpj);


--
-- Name: operacao_empresas operacao_empresas_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_empresas
    ADD CONSTRAINT operacao_empresas_pkey PRIMARY KEY (id);


--
-- Name: operacao_identificacao_empresa operacao_identificacao_empresa_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_identificacao_empresa
    ADD CONSTRAINT operacao_identificacao_empresa_pkey PRIMARY KEY (empresa_id);


--
-- Name: operacao_itens_resultado operacao_itens_resultado_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_itens_resultado
    ADD CONSTRAINT operacao_itens_resultado_pkey PRIMARY KEY (id);


--
-- Name: operacao_itens_resultado operacao_itens_resultado_processo_id_tipo_identificador_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_itens_resultado
    ADD CONSTRAINT operacao_itens_resultado_processo_id_tipo_identificador_key UNIQUE (processo_id, tipo, identificador);


--
-- Name: operacao_kit_documentos operacao_kit_documentos_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_kit_documentos
    ADD CONSTRAINT operacao_kit_documentos_pkey PRIMARY KEY (id);


--
-- Name: operacao_limites_cnpj operacao_limites_cnpj_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_limites_cnpj
    ADD CONSTRAINT operacao_limites_cnpj_pkey PRIMARY KEY (usuario_id);


--
-- Name: operacao_membros operacao_membros_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_membros
    ADD CONSTRAINT operacao_membros_pkey PRIMARY KEY (organizacao_id, usuario_id);


--
-- Name: operacao_ocorrencias operacao_ocorrencias_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_ocorrencias
    ADD CONSTRAINT operacao_ocorrencias_pkey PRIMARY KEY (id);


--
-- Name: operacao_organizacoes operacao_organizacoes_owner_id_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_organizacoes
    ADD CONSTRAINT operacao_organizacoes_owner_id_key UNIQUE (owner_id);


--
-- Name: operacao_organizacoes operacao_organizacoes_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_organizacoes
    ADD CONSTRAINT operacao_organizacoes_pkey PRIMARY KEY (id);


--
-- Name: operacao_prazos_processo operacao_prazos_processo_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_prazos_processo
    ADD CONSTRAINT operacao_prazos_processo_pkey PRIMARY KEY (id);


--
-- Name: operacao_processos operacao_processos_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_processos
    ADD CONSTRAINT operacao_processos_pkey PRIMARY KEY (id);


--
-- Name: operacao_renovacoes_documento operacao_renovacoes_documento_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_renovacoes_documento
    ADD CONSTRAINT operacao_renovacoes_documento_pkey PRIMARY KEY (id);


--
-- Name: operacao_tipos_documento operacao_tipos_documento_organizacao_id_nome_key; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_tipos_documento
    ADD CONSTRAINT operacao_tipos_documento_organizacao_id_nome_key UNIQUE (organizacao_id, nome);


--
-- Name: operacao_tipos_documento operacao_tipos_documento_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_tipos_documento
    ADD CONSTRAINT operacao_tipos_documento_pkey PRIMARY KEY (id);


--
-- Name: oportunidades_abertas oportunidades_abertas_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.oportunidades_abertas
    ADD CONSTRAINT oportunidades_abertas_pkey PRIMARY KEY (chave);


--
-- Name: uso_diario uso_diario_pkey; Type: CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.uso_diario
    ADD CONSTRAINT uso_diario_pkey PRIMARY KEY (usuario_id, funcao, dia);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.buckets_vectors
    ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);


--
-- Name: iceberg_namespaces iceberg_namespaces_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.iceberg_namespaces
    ADD CONSTRAINT iceberg_namespaces_pkey PRIMARY KEY (id);


--
-- Name: iceberg_tables iceberg_tables_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.iceberg_tables
    ADD CONSTRAINT iceberg_tables_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: INDEX identities_email_idx; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: mfa_recovery_codes_set_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX mfa_recovery_codes_set_id_idx ON auth.mfa_recovery_codes USING btree (mfa_recovery_code_set_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: scim_tokens_expires_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX scim_tokens_expires_at_idx ON auth.scim_tokens USING btree (expires_at);


--
-- Name: scim_tokens_revoked_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX scim_tokens_revoked_at_idx ON auth.scim_tokens USING btree (revoked_at);


--
-- Name: scim_tokens_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX scim_tokens_sso_provider_id_idx ON auth.scim_tokens USING btree (sso_provider_id);


--
-- Name: scim_tokens_token_hash_key; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX scim_tokens_token_hash_key ON auth.scim_tokens USING btree (token_hash);


--
-- Name: scim_users_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX scim_users_created_at_idx ON auth.scim_users USING btree (sso_provider_id, created_at, id) WHERE (deleted_at IS NULL);


--
-- Name: scim_users_deleted_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX scim_users_deleted_at_idx ON auth.scim_users USING btree (deleted_at);


--
-- Name: scim_users_external_id_key; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX scim_users_external_id_key ON auth.scim_users USING btree (sso_provider_id, external_id) WHERE ((external_id IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: scim_users_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX scim_users_id_idx ON auth.scim_users USING btree (sso_provider_id, id) WHERE (deleted_at IS NULL);


--
-- Name: scim_users_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX scim_users_sso_provider_id_idx ON auth.scim_users USING btree (sso_provider_id);


--
-- Name: scim_users_updated_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX scim_users_updated_at_idx ON auth.scim_users USING btree (sso_provider_id, updated_at, id) WHERE (deleted_at IS NULL);


--
-- Name: scim_users_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX scim_users_user_id_idx ON auth.scim_users USING btree (user_id);


--
-- Name: scim_users_user_name_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX scim_users_user_name_idx ON auth.scim_users USING btree (sso_provider_id, user_name COLLATE "C", id) WHERE (deleted_at IS NULL);


--
-- Name: scim_users_user_name_key; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX scim_users_user_name_key ON auth.scim_users USING btree (sso_provider_id, user_name) WHERE (deleted_at IS NULL);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: INDEX users_email_partial_key; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: webauthn_challenges_expires_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges USING btree (expires_at);


--
-- Name: webauthn_challenges_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges USING btree (user_id);


--
-- Name: webauthn_credentials_credential_id_key; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX webauthn_credentials_credential_id_key ON auth.webauthn_credentials USING btree (credential_id);


--
-- Name: webauthn_credentials_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials USING btree (user_id);


--
-- Name: comprasgov_resultados_compra_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX comprasgov_resultados_compra_idx ON public.comprasgov_resultados USING btree (id_compra);


--
-- Name: comprasgov_resultados_data_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX comprasgov_resultados_data_idx ON public.comprasgov_resultados USING btree (data_resultado DESC);


--
-- Name: comprasgov_resultados_descricao_item_trgm_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX comprasgov_resultados_descricao_item_trgm_idx ON public.comprasgov_resultados USING gin (descricao_item public.gin_trgm_ops);


--
-- Name: comprasgov_resultados_fornecedor_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX comprasgov_resultados_fornecedor_idx ON public.comprasgov_resultados USING btree (cnpj_fornecedor);


--
-- Name: comprasgov_resultados_uf_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX comprasgov_resultados_uf_idx ON public.comprasgov_resultados USING btree (uf);


--
-- Name: contratos_cnpj_fornecedor_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX contratos_cnpj_fornecedor_idx ON public.contratos USING btree (cnpj_fornecedor);


--
-- Name: contratos_data_assinatura_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX contratos_data_assinatura_idx ON public.contratos USING btree (data_assinatura);


--
-- Name: contratos_objeto_trgm_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX contratos_objeto_trgm_idx ON public.contratos USING gin (objeto public.gin_trgm_ops);


--
-- Name: contratos_uf_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX contratos_uf_idx ON public.contratos USING btree (uf);


--
-- Name: dossies_editais_status_atualizado_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX dossies_editais_status_atualizado_idx ON public.dossies_editais USING btree (status, atualizado_em DESC);


--
-- Name: fila_dossies_pendentes_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX fila_dossies_pendentes_idx ON public.fila_dossies USING btree (pedido_em) WHERE (concluido_em IS NULL);


--
-- Name: mercado_atas_objeto_trgm_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX mercado_atas_objeto_trgm_idx ON public.mercado_atas USING gin (objeto public.gin_trgm_ops);


--
-- Name: mercado_atas_segmentos_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX mercado_atas_segmentos_idx ON public.mercado_atas USING gin (segmentos);


--
-- Name: mercado_atas_uf_orgao_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX mercado_atas_uf_orgao_idx ON public.mercado_atas USING btree (uf_orgao);


--
-- Name: operacao_agenda_organizacao_vencimento_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX operacao_agenda_organizacao_vencimento_idx ON public.operacao_agenda USING btree (organizacao_id, vencimento);


--
-- Name: operacao_anexos_processo_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX operacao_anexos_processo_idx ON public.operacao_anexos_processo USING btree (processo_id, criado_em DESC);


--
-- Name: operacao_contratos_processo_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX operacao_contratos_processo_idx ON public.operacao_contratos USING btree (processo_id);


--
-- Name: operacao_documentos_empresa_vencimento_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX operacao_documentos_empresa_vencimento_idx ON public.operacao_documentos USING btree (empresa_id, vencimento);


--
-- Name: operacao_empenhos_processo_status_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX operacao_empenhos_processo_status_idx ON public.operacao_empenhos USING btree (processo_id, status);


--
-- Name: operacao_empresas_id_org_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX operacao_empresas_id_org_idx ON public.operacao_empresas USING btree (id, organizacao_id);


--
-- Name: operacao_itens_resultado_processo_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX operacao_itens_resultado_processo_idx ON public.operacao_itens_resultado USING btree (processo_id, identificador);


--
-- Name: operacao_kit_documentos_escopo_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX operacao_kit_documentos_escopo_idx ON public.operacao_kit_documentos USING btree (organizacao_id, empresa_id, processo_id, atualizado_em DESC);


--
-- Name: operacao_ocorrencias_processo_data_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX operacao_ocorrencias_processo_data_idx ON public.operacao_ocorrencias USING btree (processo_id, ocorrido_em DESC);


--
-- Name: operacao_prazos_processo_vencimento_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX operacao_prazos_processo_vencimento_idx ON public.operacao_prazos_processo USING btree (processo_id, vencimento);


--
-- Name: operacao_processos_empresa_status_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX operacao_processos_empresa_status_idx ON public.operacao_processos USING btree (empresa_id, status);


--
-- Name: operacao_processos_id_empresa_org_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX operacao_processos_id_empresa_org_idx ON public.operacao_processos USING btree (id, empresa_id, organizacao_id);


--
-- Name: operacao_processos_id_org_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX operacao_processos_id_org_idx ON public.operacao_processos USING btree (id, organizacao_id);


--
-- Name: operacao_processos_organizacao_sessao_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX operacao_processos_organizacao_sessao_idx ON public.operacao_processos USING btree (organizacao_id, data_sessao);


--
-- Name: operacao_processos_origem_externa_unica_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE UNIQUE INDEX operacao_processos_origem_externa_unica_idx ON public.operacao_processos USING btree (organizacao_id, empresa_id, origem_externa_id) WHERE (origem_externa_id IS NOT NULL);


--
-- Name: oportunidades_abertas_encerramento_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX oportunidades_abertas_encerramento_idx ON public.oportunidades_abertas USING btree (encerramento);


--
-- Name: oportunidades_abertas_publicacao_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX oportunidades_abertas_publicacao_idx ON public.oportunidades_abertas USING btree (publicacao);


--
-- Name: oportunidades_abertas_uf_idx; Type: INDEX; Schema: public; Owner: supabase_admin
--

CREATE INDEX oportunidades_abertas_uf_idx ON public.oportunidades_abertas USING btree (uf);


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: idx_iceberg_namespaces_bucket_id; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX idx_iceberg_namespaces_bucket_id ON storage.iceberg_namespaces USING btree (catalog_id, name);


--
-- Name: idx_iceberg_tables_location; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX idx_iceberg_tables_location ON storage.iceberg_tables USING btree (location);


--
-- Name: idx_iceberg_tables_namespace_id; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX idx_iceberg_tables_namespace_id ON storage.iceberg_tables USING btree (catalog_id, namespace_id, name);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_bucket_id_name_lower; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");


--
-- Name: idx_objects_current_version; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX idx_objects_current_version ON storage.objects USING btree (bucket_id, name COLLATE "C") WHERE (archived_at IS NULL);


--
-- Name: idx_objects_null_version; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX idx_objects_null_version ON storage.objects USING btree (bucket_id, name COLLATE "C") WHERE (NOT is_versioned);


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: objects_bucket_id_name_version_key; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX objects_bucket_id_name_version_key ON storage.objects USING btree (bucket_id, name COLLATE "C", version) NULLS NOT DISTINCT;


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);


--
-- Name: users qa_criar_cliente_no_cadastro; Type: TRIGGER; Schema: auth; Owner: supabase_auth_admin
--

CREATE TRIGGER qa_criar_cliente_no_cadastro AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.criar_cliente_no_cadastro();


--
-- Name: TRIGGER qa_criar_cliente_no_cadastro ON users; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TRIGGER qa_criar_cliente_no_cadastro ON auth.users IS 'Fixture QA: vinculo ausente no schema versionado do produto';


--
-- Name: operacao_empresas identificacao_cadastro_alterado; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER identificacao_cadastro_alterado AFTER UPDATE ON public.operacao_empresas FOR EACH ROW EXECUTE FUNCTION public.invalidar_identificacao_empresa();


--
-- Name: operacao_documentos identificacao_documento_alterado; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER identificacao_documento_alterado AFTER DELETE OR UPDATE ON public.operacao_documentos FOR EACH ROW EXECUTE FUNCTION public.invalidar_identificacao_empresa();


--
-- Name: operacao_kit_documentos kit_documento_escopo_imutavel; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER kit_documento_escopo_imutavel BEFORE UPDATE ON public.operacao_kit_documentos FOR EACH ROW EXECUTE FUNCTION public.kit_documento_escopo_imutavel();


--
-- Name: operacao_empresas operacao_empresas_limite_cnpjs; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER operacao_empresas_limite_cnpjs BEFORE INSERT OR UPDATE OF ativo, organizacao_id ON public.operacao_empresas FOR EACH ROW EXECUTE FUNCTION public.verificar_limite_cnpjs_operacao();


--
-- Name: operacao_documentos preservar_escopo_operacao; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER preservar_escopo_operacao BEFORE UPDATE ON public.operacao_documentos FOR EACH ROW EXECUTE FUNCTION public.preservar_escopo_operacao();


--
-- Name: operacao_processos preservar_escopo_operacao; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER preservar_escopo_operacao BEFORE UPDATE ON public.operacao_processos FOR EACH ROW EXECUTE FUNCTION public.preservar_escopo_operacao();


--
-- Name: clientes proteger_status_cliente_operacao; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER proteger_status_cliente_operacao BEFORE INSERT OR UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.proteger_status_cliente_operacao();


--
-- Name: operacao_anexos_processo validar_arquivo_processo_operacao; Type: TRIGGER; Schema: public; Owner: supabase_admin
--

CREATE TRIGGER validar_arquivo_processo_operacao BEFORE INSERT OR UPDATE ON public.operacao_anexos_processo FOR EACH ROW EXECUTE FUNCTION public.validar_arquivo_processo_operacao();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: objects identificacao_arquivo_alterado; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER identificacao_arquivo_alterado AFTER DELETE OR UPDATE ON storage.objects FOR EACH ROW WHEN ((old.bucket_id = 'operacao-documentos'::text)) EXECUTE FUNCTION public.invalidar_identificacao_empresa();


--
-- Name: buckets protect_bucket_control_insert; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER protect_bucket_control_insert BEFORE INSERT ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns('service_role');


--
-- Name: buckets protect_bucket_control_update; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER protect_bucket_control_update BEFORE UPDATE OF lifecycle_configuration, lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns();


--
-- Name: buckets protect_bucket_control_update_role; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER protect_bucket_control_update_role AFTER UPDATE OF lifecycle_configuration, lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_lifecycle_service_role('service_role');


--
-- Name: buckets protect_buckets_delete; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects protect_objects_delete; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_recovery_code_sets mfa_recovery_code_sets_mfa_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_recovery_code_sets
    ADD CONSTRAINT mfa_recovery_code_sets_mfa_factor_id_fkey FOREIGN KEY (mfa_factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_recovery_code_sets mfa_recovery_code_sets_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_recovery_code_sets
    ADD CONSTRAINT mfa_recovery_code_sets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_recovery_codes mfa_recovery_codes_mfa_recovery_code_set_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_recovery_codes
    ADD CONSTRAINT mfa_recovery_codes_mfa_recovery_code_set_id_fkey FOREIGN KEY (mfa_recovery_code_set_id) REFERENCES auth.mfa_recovery_code_sets(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: scim_tokens scim_tokens_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.scim_tokens
    ADD CONSTRAINT scim_tokens_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: scim_users scim_users_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.scim_users
    ADD CONSTRAINT scim_users_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: scim_users scim_users_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.scim_users
    ADD CONSTRAINT scim_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: clientes clientes_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: lembretes lembretes_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.lembretes
    ADD CONSTRAINT lembretes_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: logs_boletim logs_boletim_cliente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.logs_boletim
    ADD CONSTRAINT logs_boletim_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: operacao_agenda operacao_agenda_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_agenda
    ADD CONSTRAINT operacao_agenda_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.operacao_empresas(id) ON DELETE CASCADE;


--
-- Name: operacao_agenda operacao_agenda_escopo_fk; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_agenda
    ADD CONSTRAINT operacao_agenda_escopo_fk FOREIGN KEY (empresa_id, organizacao_id) REFERENCES public.operacao_empresas(id, organizacao_id) ON DELETE CASCADE;


--
-- Name: operacao_agenda operacao_agenda_organizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_agenda
    ADD CONSTRAINT operacao_agenda_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.operacao_organizacoes(id) ON DELETE CASCADE;


--
-- Name: operacao_anexos_processo operacao_anexos_processo_processo_id_organizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_anexos_processo
    ADD CONSTRAINT operacao_anexos_processo_processo_id_organizacao_id_fkey FOREIGN KEY (processo_id, organizacao_id) REFERENCES public.operacao_processos(id, organizacao_id) ON DELETE CASCADE;


--
-- Name: operacao_contratos operacao_contratos_processo_id_organizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_contratos
    ADD CONSTRAINT operacao_contratos_processo_id_organizacao_id_fkey FOREIGN KEY (processo_id, organizacao_id) REFERENCES public.operacao_processos(id, organizacao_id) ON DELETE CASCADE;


--
-- Name: operacao_convites_empresa operacao_convites_empresa_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_convites_empresa
    ADD CONSTRAINT operacao_convites_empresa_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES auth.users(id);


--
-- Name: operacao_convites_empresa operacao_convites_empresa_empresa_id_organizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_convites_empresa
    ADD CONSTRAINT operacao_convites_empresa_empresa_id_organizacao_id_fkey FOREIGN KEY (empresa_id, organizacao_id) REFERENCES public.operacao_empresas(id, organizacao_id) ON DELETE CASCADE;


--
-- Name: operacao_convites_empresa operacao_convites_empresa_organizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_convites_empresa
    ADD CONSTRAINT operacao_convites_empresa_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.operacao_organizacoes(id) ON DELETE CASCADE;


--
-- Name: operacao_documentos operacao_documentos_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_documentos
    ADD CONSTRAINT operacao_documentos_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES auth.users(id);


--
-- Name: operacao_documentos operacao_documentos_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_documentos
    ADD CONSTRAINT operacao_documentos_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.operacao_empresas(id) ON DELETE CASCADE;


--
-- Name: operacao_documentos operacao_documentos_escopo_fk; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_documentos
    ADD CONSTRAINT operacao_documentos_escopo_fk FOREIGN KEY (empresa_id, organizacao_id) REFERENCES public.operacao_empresas(id, organizacao_id) ON DELETE CASCADE;


--
-- Name: operacao_documentos operacao_documentos_organizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_documentos
    ADD CONSTRAINT operacao_documentos_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.operacao_organizacoes(id) ON DELETE CASCADE;


--
-- Name: operacao_empenhos operacao_empenhos_escopo_fk; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_empenhos
    ADD CONSTRAINT operacao_empenhos_escopo_fk FOREIGN KEY (processo_id, organizacao_id) REFERENCES public.operacao_processos(id, organizacao_id) ON DELETE CASCADE;


--
-- Name: operacao_empenhos operacao_empenhos_organizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_empenhos
    ADD CONSTRAINT operacao_empenhos_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.operacao_organizacoes(id) ON DELETE CASCADE;


--
-- Name: operacao_empenhos operacao_empenhos_processo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_empenhos
    ADD CONSTRAINT operacao_empenhos_processo_id_fkey FOREIGN KEY (processo_id) REFERENCES public.operacao_processos(id) ON DELETE CASCADE;


--
-- Name: operacao_empresas operacao_empresas_organizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_empresas
    ADD CONSTRAINT operacao_empresas_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.operacao_organizacoes(id) ON DELETE CASCADE;


--
-- Name: operacao_identificacao_empresa operacao_identificacao_empresa_confirmado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_identificacao_empresa
    ADD CONSTRAINT operacao_identificacao_empresa_confirmado_por_fkey FOREIGN KEY (confirmado_por) REFERENCES auth.users(id);


--
-- Name: operacao_identificacao_empresa operacao_identificacao_empresa_empresa_id_organizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_identificacao_empresa
    ADD CONSTRAINT operacao_identificacao_empresa_empresa_id_organizacao_id_fkey FOREIGN KEY (empresa_id, organizacao_id) REFERENCES public.operacao_empresas(id, organizacao_id) ON DELETE CASCADE;


--
-- Name: operacao_itens_resultado operacao_itens_resultado_processo_id_organizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_itens_resultado
    ADD CONSTRAINT operacao_itens_resultado_processo_id_organizacao_id_fkey FOREIGN KEY (processo_id, organizacao_id) REFERENCES public.operacao_processos(id, organizacao_id) ON DELETE CASCADE;


--
-- Name: operacao_kit_documentos operacao_kit_documentos_atualizado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_kit_documentos
    ADD CONSTRAINT operacao_kit_documentos_atualizado_por_fkey FOREIGN KEY (atualizado_por) REFERENCES auth.users(id);


--
-- Name: operacao_kit_documentos operacao_kit_documentos_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_kit_documentos
    ADD CONSTRAINT operacao_kit_documentos_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES auth.users(id);


--
-- Name: operacao_kit_documentos operacao_kit_documentos_processo_id_empresa_id_organizacao_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_kit_documentos
    ADD CONSTRAINT operacao_kit_documentos_processo_id_empresa_id_organizacao_fkey FOREIGN KEY (processo_id, empresa_id, organizacao_id) REFERENCES public.operacao_processos(id, empresa_id, organizacao_id);


--
-- Name: operacao_kit_documentos operacao_kit_documentos_revisado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_kit_documentos
    ADD CONSTRAINT operacao_kit_documentos_revisado_por_fkey FOREIGN KEY (revisado_por) REFERENCES auth.users(id);


--
-- Name: operacao_limites_cnpj operacao_limites_cnpj_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_limites_cnpj
    ADD CONSTRAINT operacao_limites_cnpj_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: operacao_membros operacao_membros_empresa_org_fk; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_membros
    ADD CONSTRAINT operacao_membros_empresa_org_fk FOREIGN KEY (empresa_id, organizacao_id) REFERENCES public.operacao_empresas(id, organizacao_id) ON DELETE CASCADE;


--
-- Name: operacao_membros operacao_membros_organizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_membros
    ADD CONSTRAINT operacao_membros_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.operacao_organizacoes(id) ON DELETE CASCADE;


--
-- Name: operacao_membros operacao_membros_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_membros
    ADD CONSTRAINT operacao_membros_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: operacao_ocorrencias operacao_ocorrencias_processo_id_organizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_ocorrencias
    ADD CONSTRAINT operacao_ocorrencias_processo_id_organizacao_id_fkey FOREIGN KEY (processo_id, organizacao_id) REFERENCES public.operacao_processos(id, organizacao_id) ON DELETE CASCADE;


--
-- Name: operacao_organizacoes operacao_organizacoes_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_organizacoes
    ADD CONSTRAINT operacao_organizacoes_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: operacao_prazos_processo operacao_prazos_processo_escopo_fk; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_prazos_processo
    ADD CONSTRAINT operacao_prazos_processo_escopo_fk FOREIGN KEY (processo_id, organizacao_id) REFERENCES public.operacao_processos(id, organizacao_id) ON DELETE CASCADE;


--
-- Name: operacao_prazos_processo operacao_prazos_processo_organizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_prazos_processo
    ADD CONSTRAINT operacao_prazos_processo_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.operacao_organizacoes(id) ON DELETE CASCADE;


--
-- Name: operacao_prazos_processo operacao_prazos_processo_processo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_prazos_processo
    ADD CONSTRAINT operacao_prazos_processo_processo_id_fkey FOREIGN KEY (processo_id) REFERENCES public.operacao_processos(id) ON DELETE CASCADE;


--
-- Name: operacao_processos operacao_processos_criado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_processos
    ADD CONSTRAINT operacao_processos_criado_por_fkey FOREIGN KEY (criado_por) REFERENCES auth.users(id);


--
-- Name: operacao_processos operacao_processos_empresa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_processos
    ADD CONSTRAINT operacao_processos_empresa_id_fkey FOREIGN KEY (empresa_id) REFERENCES public.operacao_empresas(id) ON DELETE CASCADE;


--
-- Name: operacao_processos operacao_processos_escopo_fk; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_processos
    ADD CONSTRAINT operacao_processos_escopo_fk FOREIGN KEY (empresa_id, organizacao_id) REFERENCES public.operacao_empresas(id, organizacao_id) ON DELETE CASCADE;


--
-- Name: operacao_processos operacao_processos_organizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_processos
    ADD CONSTRAINT operacao_processos_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.operacao_organizacoes(id) ON DELETE CASCADE;


--
-- Name: operacao_renovacoes_documento operacao_renovacoes_documento_documento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_renovacoes_documento
    ADD CONSTRAINT operacao_renovacoes_documento_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES public.operacao_documentos(id) ON DELETE CASCADE;


--
-- Name: operacao_renovacoes_documento operacao_renovacoes_documento_registrado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_renovacoes_documento
    ADD CONSTRAINT operacao_renovacoes_documento_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES auth.users(id);


--
-- Name: operacao_tipos_documento operacao_tipos_documento_organizacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.operacao_tipos_documento
    ADD CONSTRAINT operacao_tipos_documento_organizacao_id_fkey FOREIGN KEY (organizacao_id) REFERENCES public.operacao_organizacoes(id) ON DELETE CASCADE;


--
-- Name: uso_diario uso_diario_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: supabase_admin
--

ALTER TABLE ONLY public.uso_diario
    ADD CONSTRAINT uso_diario_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: iceberg_namespaces iceberg_namespaces_catalog_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.iceberg_namespaces
    ADD CONSTRAINT iceberg_namespaces_catalog_id_fkey FOREIGN KEY (catalog_id) REFERENCES storage.buckets_analytics(id) ON DELETE CASCADE;


--
-- Name: iceberg_tables iceberg_tables_catalog_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.iceberg_tables
    ADD CONSTRAINT iceberg_tables_catalog_id_fkey FOREIGN KEY (catalog_id) REFERENCES storage.buckets_analytics(id) ON DELETE CASCADE;


--
-- Name: iceberg_tables iceberg_tables_namespace_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.iceberg_tables
    ADD CONSTRAINT iceberg_tables_namespace_id_fkey FOREIGN KEY (namespace_id) REFERENCES storage.iceberg_namespaces(id) ON DELETE CASCADE;


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id);


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: admins; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

--
-- Name: admins admins_select_proprio; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY admins_select_proprio ON public.admins FOR SELECT USING ((lower(email) = lower((auth.jwt() ->> 'email'::text))));


--
-- Name: clientes; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

--
-- Name: clientes clientes_insert_proprio; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY clientes_insert_proprio ON public.clientes FOR INSERT WITH CHECK ((auth.uid() = id));


--
-- Name: clientes clientes_select_proprio; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY clientes_select_proprio ON public.clientes FOR SELECT USING ((auth.uid() = id));


--
-- Name: clientes clientes_update_proprio; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY clientes_update_proprio ON public.clientes FOR UPDATE USING ((auth.uid() = id));


--
-- Name: comprasgov_resultados; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.comprasgov_resultados ENABLE ROW LEVEL SECURITY;

--
-- Name: comprasgov_resultados comprasgov_resultados_select_autenticado; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY comprasgov_resultados_select_autenticado ON public.comprasgov_resultados FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: contratos; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.contratos ENABLE ROW LEVEL SECURITY;

--
-- Name: contratos contratos_select_autenticado; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY contratos_select_autenticado ON public.contratos FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: dados_robo; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.dados_robo ENABLE ROW LEVEL SECURITY;

--
-- Name: dados_robo dados_robo_qa_publicos; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY dados_robo_qa_publicos ON public.dados_robo FOR SELECT TO authenticated USING ((chave = ANY (ARRAY['oportunidades_meta'::text, 'convenios'::text, 'sistema_s_am'::text, 'config_admin'::text])));


--
-- Name: dossies_editais; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.dossies_editais ENABLE ROW LEVEL SECURITY;

--
-- Name: dossies_editais dossies_editais_select_autenticado; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY dossies_editais_select_autenticado ON public.dossies_editais FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: fila_dossies; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.fila_dossies ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_identificacao_empresa identificacao_empresa_leitura; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY identificacao_empresa_leitura ON public.operacao_identificacao_empresa FOR SELECT TO authenticated USING (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));


--
-- Name: lembretes; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.lembretes ENABLE ROW LEVEL SECURITY;

--
-- Name: lembretes lembretes_qa_proprios; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY lembretes_qa_proprios ON public.lembretes TO authenticated USING ((cliente_id = auth.uid())) WITH CHECK ((cliente_id = auth.uid()));


--
-- Name: logs_boletim; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.logs_boletim ENABLE ROW LEVEL SECURITY;

--
-- Name: mercado_atas; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.mercado_atas ENABLE ROW LEVEL SECURITY;

--
-- Name: mercado_atas mercado_atas_select_autenticado; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY mercado_atas_select_autenticado ON public.mercado_atas FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: operacao_agenda; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_agenda ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_agenda operacao_agenda_da_empresa; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_agenda_da_empresa ON public.operacao_agenda FOR SELECT TO authenticated USING (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));


--
-- Name: operacao_agenda operacao_agenda_da_empresa_escrita; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_agenda_da_empresa_escrita ON public.operacao_agenda TO authenticated USING (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id)) WITH CHECK (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));


--
-- Name: operacao_anexos_processo operacao_anexos_da_empresa; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_anexos_da_empresa ON public.operacao_anexos_processo FOR SELECT TO authenticated USING (public.pode_acessar_processo_operacao(organizacao_id, processo_id));


--
-- Name: operacao_anexos_processo operacao_anexos_da_empresa_escrita; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_anexos_da_empresa_escrita ON public.operacao_anexos_processo TO authenticated USING (public.pode_escrever_processo_operacao(organizacao_id, processo_id)) WITH CHECK ((public.pode_escrever_processo_operacao(organizacao_id, processo_id) AND (EXISTS ( SELECT 1
   FROM public.operacao_processos p
  WHERE ((p.id = operacao_anexos_processo.processo_id) AND (p.organizacao_id = operacao_anexos_processo.organizacao_id) AND public.arquivo_no_escopo_operacao(operacao_anexos_processo.arquivo_caminho, p.organizacao_id, p.empresa_id))))));


--
-- Name: operacao_anexos_processo; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_anexos_processo ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_contratos; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_contratos ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_contratos operacao_contratos_da_empresa; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_contratos_da_empresa ON public.operacao_contratos FOR SELECT TO authenticated USING (public.pode_acessar_processo_operacao(organizacao_id, processo_id));


--
-- Name: operacao_contratos operacao_contratos_da_empresa_escrita; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_contratos_da_empresa_escrita ON public.operacao_contratos TO authenticated USING (public.pode_escrever_processo_operacao(organizacao_id, processo_id)) WITH CHECK (public.pode_escrever_processo_operacao(organizacao_id, processo_id));


--
-- Name: operacao_convites_empresa; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_convites_empresa ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_documentos; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_documentos ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_documentos operacao_documentos_da_empresa; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_documentos_da_empresa ON public.operacao_documentos FOR SELECT TO authenticated USING (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));


--
-- Name: operacao_documentos operacao_documentos_da_empresa_escrita; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_documentos_da_empresa_escrita ON public.operacao_documentos TO authenticated USING (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id)) WITH CHECK ((public.pode_escrever_empresa_operacao(organizacao_id, empresa_id) AND public.arquivo_no_escopo_operacao(arquivo_caminho, organizacao_id, empresa_id)));


--
-- Name: operacao_empenhos; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_empenhos ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_empenhos operacao_empenhos_da_empresa; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_empenhos_da_empresa ON public.operacao_empenhos FOR SELECT TO authenticated USING (public.pode_acessar_processo_operacao(organizacao_id, processo_id));


--
-- Name: operacao_empenhos operacao_empenhos_da_empresa_escrita; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_empenhos_da_empresa_escrita ON public.operacao_empenhos TO authenticated USING (public.pode_escrever_processo_operacao(organizacao_id, processo_id)) WITH CHECK (public.pode_escrever_processo_operacao(organizacao_id, processo_id));


--
-- Name: operacao_empresas; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_empresas ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_empresas operacao_empresas_escrita; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_empresas_escrita ON public.operacao_empresas TO authenticated USING (public.pode_escrever_org_operacao(organizacao_id)) WITH CHECK (public.pode_escrever_org_operacao(organizacao_id));


--
-- Name: operacao_empresas operacao_empresas_leitura; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_empresas_leitura ON public.operacao_empresas FOR SELECT USING (public.pode_acessar_empresa_operacao(organizacao_id, id));


--
-- Name: operacao_identificacao_empresa; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_identificacao_empresa ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_itens_resultado operacao_itens_da_empresa; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_itens_da_empresa ON public.operacao_itens_resultado FOR SELECT TO authenticated USING (public.pode_acessar_processo_operacao(organizacao_id, processo_id));


--
-- Name: operacao_itens_resultado operacao_itens_da_empresa_escrita; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_itens_da_empresa_escrita ON public.operacao_itens_resultado TO authenticated USING (public.pode_escrever_processo_operacao(organizacao_id, processo_id)) WITH CHECK (public.pode_escrever_processo_operacao(organizacao_id, processo_id));


--
-- Name: operacao_itens_resultado; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_itens_resultado ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_kit_documentos; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_kit_documentos ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_kit_documentos operacao_kit_documentos_select_empresa; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_kit_documentos_select_empresa ON public.operacao_kit_documentos FOR SELECT TO authenticated USING ((public.pode_acessar_empresa_operacao(organizacao_id, empresa_id) AND (EXISTS ( SELECT 1
   FROM public.clientes c
  WHERE ((c.id = auth.uid()) AND (c.status = 'aprovado'::text)))) AND (EXISTS ( SELECT 1
   FROM public.operacao_empresas e
  WHERE ((e.id = operacao_kit_documentos.empresa_id) AND (e.organizacao_id = operacao_kit_documentos.organizacao_id) AND e.ativo)))));


--
-- Name: operacao_limites_cnpj; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_limites_cnpj ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_membros; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_membros ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_membros operacao_membros_da_org; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_membros_da_org ON public.operacao_membros FOR SELECT USING (((usuario_id = auth.uid()) OR public.eh_membro_operacao(organizacao_id)));


--
-- Name: operacao_ocorrencias; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_ocorrencias ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_ocorrencias operacao_ocorrencias_da_empresa; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_ocorrencias_da_empresa ON public.operacao_ocorrencias FOR SELECT TO authenticated USING (public.pode_acessar_processo_operacao(organizacao_id, processo_id));


--
-- Name: operacao_ocorrencias operacao_ocorrencias_da_empresa_escrita; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_ocorrencias_da_empresa_escrita ON public.operacao_ocorrencias TO authenticated USING (public.pode_escrever_processo_operacao(organizacao_id, processo_id)) WITH CHECK (public.pode_escrever_processo_operacao(organizacao_id, processo_id));


--
-- Name: operacao_organizacoes; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_organizacoes ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_organizacoes operacao_organizacoes_proprias; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_organizacoes_proprias ON public.operacao_organizacoes FOR SELECT USING (public.tem_vinculo_operacao(id));


--
-- Name: operacao_prazos_processo operacao_prazos_da_empresa; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_prazos_da_empresa ON public.operacao_prazos_processo FOR SELECT TO authenticated USING (public.pode_acessar_processo_operacao(organizacao_id, processo_id));


--
-- Name: operacao_prazos_processo operacao_prazos_da_empresa_escrita; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_prazos_da_empresa_escrita ON public.operacao_prazos_processo TO authenticated USING (public.pode_escrever_processo_operacao(organizacao_id, processo_id)) WITH CHECK (public.pode_escrever_processo_operacao(organizacao_id, processo_id));


--
-- Name: operacao_prazos_processo; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_prazos_processo ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_processos; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_processos ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_processos operacao_processos_da_empresa; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_processos_da_empresa ON public.operacao_processos FOR SELECT TO authenticated USING (public.pode_acessar_empresa_operacao(organizacao_id, empresa_id));


--
-- Name: operacao_processos operacao_processos_da_empresa_escrita; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_processos_da_empresa_escrita ON public.operacao_processos TO authenticated USING (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id)) WITH CHECK (public.pode_escrever_empresa_operacao(organizacao_id, empresa_id));


--
-- Name: operacao_renovacoes_documento operacao_renovacoes_da_empresa; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_renovacoes_da_empresa ON public.operacao_renovacoes_documento FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.operacao_documentos d
  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND public.pode_acessar_empresa_operacao(d.organizacao_id, d.empresa_id)))));


--
-- Name: operacao_renovacoes_documento operacao_renovacoes_da_empresa_escrita; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_renovacoes_da_empresa_escrita ON public.operacao_renovacoes_documento TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.operacao_documentos d
  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND public.pode_escrever_empresa_operacao(d.organizacao_id, d.empresa_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.operacao_documentos d
  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND public.pode_escrever_empresa_operacao(d.organizacao_id, d.empresa_id)))));


--
-- Name: operacao_renovacoes_documento; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_renovacoes_documento ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_tipos_documento; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.operacao_tipos_documento ENABLE ROW LEVEL SECURITY;

--
-- Name: operacao_tipos_documento operacao_tipos_escrita; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_tipos_escrita ON public.operacao_tipos_documento TO authenticated USING (((organizacao_id IS NOT NULL) AND public.pode_escrever_org_operacao(organizacao_id))) WITH CHECK (((organizacao_id IS NOT NULL) AND public.pode_escrever_org_operacao(organizacao_id)));


--
-- Name: operacao_tipos_documento operacao_tipos_leitura; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY operacao_tipos_leitura ON public.operacao_tipos_documento FOR SELECT USING (((organizacao_id IS NULL) OR public.eh_membro_operacao(organizacao_id)));


--
-- Name: oportunidades_abertas; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.oportunidades_abertas ENABLE ROW LEVEL SECURITY;

--
-- Name: oportunidades_abertas oportunidades_abertas_select_autenticado; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY oportunidades_abertas_select_autenticado ON public.oportunidades_abertas FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: uso_diario; Type: ROW SECURITY; Schema: public; Owner: supabase_admin
--

ALTER TABLE public.uso_diario ENABLE ROW LEVEL SECURITY;

--
-- Name: uso_diario uso_diario_select_proprio; Type: POLICY; Schema: public; Owner: supabase_admin
--

CREATE POLICY uso_diario_select_proprio ON public.uso_diario FOR SELECT USING ((auth.uid() = usuario_id));


--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.buckets_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: iceberg_namespaces; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.iceberg_namespaces ENABLE ROW LEVEL SECURITY;

--
-- Name: iceberg_tables; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.iceberg_tables ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: objects operacao_arquivos_atualizacao; Type: POLICY; Schema: storage; Owner: supabase_storage_admin
--

CREATE POLICY operacao_arquivos_atualizacao ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'operacao-documentos'::text) AND public.escrita_arquivo_operacao(name))) WITH CHECK (((bucket_id = 'operacao-documentos'::text) AND public.escrita_arquivo_operacao(name)));


--
-- Name: objects operacao_arquivos_envio; Type: POLICY; Schema: storage; Owner: supabase_storage_admin
--

CREATE POLICY operacao_arquivos_envio ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'operacao-documentos'::text) AND public.escrita_arquivo_operacao(name)));


--
-- Name: objects operacao_arquivos_exclusao; Type: POLICY; Schema: storage; Owner: supabase_storage_admin
--

CREATE POLICY operacao_arquivos_exclusao ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'operacao-documentos'::text) AND public.escrita_arquivo_operacao(name)));


--
-- Name: objects operacao_arquivos_leitura; Type: POLICY; Schema: storage; Owner: supabase_storage_admin
--

CREATE POLICY operacao_arquivos_leitura ON storage.objects FOR SELECT USING (((bucket_id = 'operacao-documentos'::text) AND public.acesso_arquivo_operacao(name)));


--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.vector_indexes ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA auth; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA auth TO anon;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
GRANT ALL ON SCHEMA auth TO dashboard_user;
GRANT USAGE ON SCHEMA auth TO postgres;


--
-- Name: SCHEMA extensions; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA extensions TO anon;
GRANT USAGE ON SCHEMA extensions TO authenticated;
GRANT USAGE ON SCHEMA extensions TO service_role;
GRANT ALL ON SCHEMA extensions TO dashboard_user;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: SCHEMA storage; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA storage TO postgres WITH GRANT OPTION;
GRANT USAGE ON SCHEMA storage TO anon;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT USAGE ON SCHEMA storage TO service_role;
GRANT ALL ON SCHEMA storage TO supabase_storage_admin WITH GRANT OPTION;
GRANT ALL ON SCHEMA storage TO dashboard_user;


--
-- Name: FUNCTION gtrgm_in(cstring); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_in(cstring) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_in(cstring) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_in(cstring) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_in(cstring) TO service_role;


--
-- Name: FUNCTION gtrgm_out(public.gtrgm); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_out(public.gtrgm) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_out(public.gtrgm) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_out(public.gtrgm) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_out(public.gtrgm) TO service_role;


--
-- Name: FUNCTION email(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.email() TO dashboard_user;


--
-- Name: FUNCTION jwt(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.jwt() TO postgres;
GRANT ALL ON FUNCTION auth.jwt() TO dashboard_user;


--
-- Name: FUNCTION role(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.role() TO dashboard_user;


--
-- Name: FUNCTION uid(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.uid() TO dashboard_user;


--
-- Name: FUNCTION grant_pg_cron_access(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION extensions.grant_pg_cron_access() FROM supabase_admin;
GRANT ALL ON FUNCTION extensions.grant_pg_cron_access() TO supabase_admin WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.grant_pg_cron_access() TO dashboard_user;


--
-- Name: FUNCTION grant_pg_graphql_access(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.grant_pg_graphql_access() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION grant_pg_net_access(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION extensions.grant_pg_net_access() FROM supabase_admin;
GRANT ALL ON FUNCTION extensions.grant_pg_net_access() TO supabase_admin WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.grant_pg_net_access() TO dashboard_user;


--
-- Name: FUNCTION pgrst_ddl_watch(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgrst_ddl_watch() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION pgrst_drop_watch(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgrst_drop_watch() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION set_graphql_placeholder(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.set_graphql_placeholder() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION aceitar_convite_empresa_operacao(p_token uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.aceitar_convite_empresa_operacao(p_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.aceitar_convite_empresa_operacao(p_token uuid) TO postgres;
GRANT ALL ON FUNCTION public.aceitar_convite_empresa_operacao(p_token uuid) TO authenticated;
GRANT ALL ON FUNCTION public.aceitar_convite_empresa_operacao(p_token uuid) TO service_role;


--
-- Name: FUNCTION acesso_arquivo_operacao(p_caminho text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.acesso_arquivo_operacao(p_caminho text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.acesso_arquivo_operacao(p_caminho text) TO postgres;
GRANT ALL ON FUNCTION public.acesso_arquivo_operacao(p_caminho text) TO authenticated;
GRANT ALL ON FUNCTION public.acesso_arquivo_operacao(p_caminho text) TO service_role;


--
-- Name: FUNCTION arquivo_no_escopo_operacao(p_caminho text, p_org uuid, p_empresa uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.arquivo_no_escopo_operacao(p_caminho text, p_org uuid, p_empresa uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.arquivo_no_escopo_operacao(p_caminho text, p_org uuid, p_empresa uuid) TO postgres;
GRANT ALL ON FUNCTION public.arquivo_no_escopo_operacao(p_caminho text, p_org uuid, p_empresa uuid) TO authenticated;
GRANT ALL ON FUNCTION public.arquivo_no_escopo_operacao(p_caminho text, p_org uuid, p_empresa uuid) TO service_role;


--
-- Name: FUNCTION bootstrap_operacao(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.bootstrap_operacao() FROM PUBLIC;
GRANT ALL ON FUNCTION public.bootstrap_operacao() TO postgres;
GRANT ALL ON FUNCTION public.bootstrap_operacao() TO authenticated;
GRANT ALL ON FUNCTION public.bootstrap_operacao() TO service_role;


--
-- Name: FUNCTION configurar_limite_cnpjs_cliente(p_usuario_id uuid, p_limite integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.configurar_limite_cnpjs_cliente(p_usuario_id uuid, p_limite integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.configurar_limite_cnpjs_cliente(p_usuario_id uuid, p_limite integer) TO postgres;
GRANT ALL ON FUNCTION public.configurar_limite_cnpjs_cliente(p_usuario_id uuid, p_limite integer) TO authenticated;
GRANT ALL ON FUNCTION public.configurar_limite_cnpjs_cliente(p_usuario_id uuid, p_limite integer) TO service_role;


--
-- Name: TABLE operacao_identificacao_empresa; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_identificacao_empresa TO postgres;
GRANT ALL ON TABLE public.operacao_identificacao_empresa TO service_role;
GRANT SELECT ON TABLE public.operacao_identificacao_empresa TO authenticated;


--
-- Name: FUNCTION confirmar_identificacao_empresa(p_empresa uuid, p_usuario uuid, p_razao text, p_cnpj text, p_dados jsonb, p_proveniencia jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.confirmar_identificacao_empresa(p_empresa uuid, p_usuario uuid, p_razao text, p_cnpj text, p_dados jsonb, p_proveniencia jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirmar_identificacao_empresa(p_empresa uuid, p_usuario uuid, p_razao text, p_cnpj text, p_dados jsonb, p_proveniencia jsonb) TO postgres;
GRANT ALL ON FUNCTION public.confirmar_identificacao_empresa(p_empresa uuid, p_usuario uuid, p_razao text, p_cnpj text, p_dados jsonb, p_proveniencia jsonb) TO service_role;


--
-- Name: FUNCTION consultar_limite_cnpjs_cliente(p_usuario_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.consultar_limite_cnpjs_cliente(p_usuario_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.consultar_limite_cnpjs_cliente(p_usuario_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.consultar_limite_cnpjs_cliente(p_usuario_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.consultar_limite_cnpjs_cliente(p_usuario_id uuid) TO service_role;


--
-- Name: FUNCTION criar_cliente_no_cadastro(); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.criar_cliente_no_cadastro() TO postgres;
GRANT ALL ON FUNCTION public.criar_cliente_no_cadastro() TO anon;
GRANT ALL ON FUNCTION public.criar_cliente_no_cadastro() TO authenticated;
GRANT ALL ON FUNCTION public.criar_cliente_no_cadastro() TO service_role;


--
-- Name: FUNCTION criar_convite_empresa_operacao(p_empresa_id uuid, p_email text, p_nome text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.criar_convite_empresa_operacao(p_empresa_id uuid, p_email text, p_nome text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.criar_convite_empresa_operacao(p_empresa_id uuid, p_email text, p_nome text) TO postgres;
GRANT ALL ON FUNCTION public.criar_convite_empresa_operacao(p_empresa_id uuid, p_email text, p_nome text) TO authenticated;
GRANT ALL ON FUNCTION public.criar_convite_empresa_operacao(p_empresa_id uuid, p_email text, p_nome text) TO service_role;


--
-- Name: FUNCTION dashboard_estados_distintos(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.dashboard_estados_distintos() FROM PUBLIC;
GRANT ALL ON FUNCTION public.dashboard_estados_distintos() TO postgres;
GRANT ALL ON FUNCTION public.dashboard_estados_distintos() TO authenticated;
GRANT ALL ON FUNCTION public.dashboard_estados_distintos() TO service_role;


--
-- Name: FUNCTION dashboard_estados_top(limite integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.dashboard_estados_top(limite integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dashboard_estados_top(limite integer) TO postgres;
GRANT ALL ON FUNCTION public.dashboard_estados_top(limite integer) TO authenticated;
GRANT ALL ON FUNCTION public.dashboard_estados_top(limite integer) TO service_role;


--
-- Name: FUNCTION dashboard_segmentos_top(limite integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.dashboard_segmentos_top(limite integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.dashboard_segmentos_top(limite integer) TO postgres;
GRANT ALL ON FUNCTION public.dashboard_segmentos_top(limite integer) TO authenticated;
GRANT ALL ON FUNCTION public.dashboard_segmentos_top(limite integer) TO service_role;


--
-- Name: FUNCTION eh_membro_operacao(p_organizacao_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.eh_membro_operacao(p_organizacao_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.eh_membro_operacao(p_organizacao_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.eh_membro_operacao(p_organizacao_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.eh_membro_operacao(p_organizacao_id uuid) TO service_role;


--
-- Name: FUNCTION eh_owner_admin_operacao(p_usuario_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.eh_owner_admin_operacao(p_usuario_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.eh_owner_admin_operacao(p_usuario_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.eh_owner_admin_operacao(p_usuario_id uuid) TO service_role;


--
-- Name: FUNCTION escrita_arquivo_operacao(p_caminho text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.escrita_arquivo_operacao(p_caminho text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.escrita_arquivo_operacao(p_caminho text) TO postgres;
GRANT ALL ON FUNCTION public.escrita_arquivo_operacao(p_caminho text) TO authenticated;
GRANT ALL ON FUNCTION public.escrita_arquivo_operacao(p_caminho text) TO service_role;


--
-- Name: FUNCTION gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal) TO postgres;
GRANT ALL ON FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal) TO anon;
GRANT ALL ON FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal) TO service_role;


--
-- Name: FUNCTION gin_extract_value_trgm(text, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gin_extract_value_trgm(text, internal) TO postgres;
GRANT ALL ON FUNCTION public.gin_extract_value_trgm(text, internal) TO anon;
GRANT ALL ON FUNCTION public.gin_extract_value_trgm(text, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gin_extract_value_trgm(text, internal) TO service_role;


--
-- Name: FUNCTION gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal) TO postgres;
GRANT ALL ON FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal) TO anon;
GRANT ALL ON FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal) TO service_role;


--
-- Name: FUNCTION gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal) TO postgres;
GRANT ALL ON FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal) TO anon;
GRANT ALL ON FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal) TO service_role;


--
-- Name: TABLE operacao_kit_documentos; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_kit_documentos TO postgres;
GRANT SELECT ON TABLE public.operacao_kit_documentos TO authenticated;
GRANT SELECT ON TABLE public.operacao_kit_documentos TO service_role;


--
-- Name: FUNCTION gravar_kit_documento(p_documento uuid, p_empresa uuid, p_processo uuid, p_organizacao uuid, p_usuario uuid, p_versao integer, p_tipo text, p_acao text, p_dados jsonb, p_hash text, p_previa jsonb); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.gravar_kit_documento(p_documento uuid, p_empresa uuid, p_processo uuid, p_organizacao uuid, p_usuario uuid, p_versao integer, p_tipo text, p_acao text, p_dados jsonb, p_hash text, p_previa jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.gravar_kit_documento(p_documento uuid, p_empresa uuid, p_processo uuid, p_organizacao uuid, p_usuario uuid, p_versao integer, p_tipo text, p_acao text, p_dados jsonb, p_hash text, p_previa jsonb) TO postgres;
GRANT ALL ON FUNCTION public.gravar_kit_documento(p_documento uuid, p_empresa uuid, p_processo uuid, p_organizacao uuid, p_usuario uuid, p_versao integer, p_tipo text, p_acao text, p_dados jsonb, p_hash text, p_previa jsonb) TO service_role;


--
-- Name: FUNCTION gtrgm_compress(internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_compress(internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_compress(internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_compress(internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_compress(internal) TO service_role;


--
-- Name: FUNCTION gtrgm_consistent(internal, text, smallint, oid, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_consistent(internal, text, smallint, oid, internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_consistent(internal, text, smallint, oid, internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_consistent(internal, text, smallint, oid, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_consistent(internal, text, smallint, oid, internal) TO service_role;


--
-- Name: FUNCTION gtrgm_decompress(internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_decompress(internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_decompress(internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_decompress(internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_decompress(internal) TO service_role;


--
-- Name: FUNCTION gtrgm_distance(internal, text, smallint, oid, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_distance(internal, text, smallint, oid, internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_distance(internal, text, smallint, oid, internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_distance(internal, text, smallint, oid, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_distance(internal, text, smallint, oid, internal) TO service_role;


--
-- Name: FUNCTION gtrgm_options(internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_options(internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_options(internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_options(internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_options(internal) TO service_role;


--
-- Name: FUNCTION gtrgm_penalty(internal, internal, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_penalty(internal, internal, internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_penalty(internal, internal, internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_penalty(internal, internal, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_penalty(internal, internal, internal) TO service_role;


--
-- Name: FUNCTION gtrgm_picksplit(internal, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_picksplit(internal, internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_picksplit(internal, internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_picksplit(internal, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_picksplit(internal, internal) TO service_role;


--
-- Name: FUNCTION gtrgm_same(public.gtrgm, public.gtrgm, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_same(public.gtrgm, public.gtrgm, internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_same(public.gtrgm, public.gtrgm, internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_same(public.gtrgm, public.gtrgm, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_same(public.gtrgm, public.gtrgm, internal) TO service_role;


--
-- Name: FUNCTION gtrgm_union(internal, internal); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.gtrgm_union(internal, internal) TO postgres;
GRANT ALL ON FUNCTION public.gtrgm_union(internal, internal) TO anon;
GRANT ALL ON FUNCTION public.gtrgm_union(internal, internal) TO authenticated;
GRANT ALL ON FUNCTION public.gtrgm_union(internal, internal) TO service_role;


--
-- Name: FUNCTION identificacao_empresa_habilitada(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.identificacao_empresa_habilitada() FROM PUBLIC;
GRANT ALL ON FUNCTION public.identificacao_empresa_habilitada() TO postgres;
GRANT ALL ON FUNCTION public.identificacao_empresa_habilitada() TO authenticated;
GRANT ALL ON FUNCTION public.identificacao_empresa_habilitada() TO service_role;


--
-- Name: FUNCTION incrementar_uso(p_usuario_id uuid, p_funcao text); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.incrementar_uso(p_usuario_id uuid, p_funcao text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.incrementar_uso(p_usuario_id uuid, p_funcao text) TO postgres;
GRANT ALL ON FUNCTION public.incrementar_uso(p_usuario_id uuid, p_funcao text) TO service_role;


--
-- Name: FUNCTION invalidar_identificacao_empresa(); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.invalidar_identificacao_empresa() TO postgres;
GRANT ALL ON FUNCTION public.invalidar_identificacao_empresa() TO anon;
GRANT ALL ON FUNCTION public.invalidar_identificacao_empresa() TO authenticated;
GRANT ALL ON FUNCTION public.invalidar_identificacao_empresa() TO service_role;


--
-- Name: FUNCTION kit_documento_escopo_imutavel(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.kit_documento_escopo_imutavel() FROM PUBLIC;
GRANT ALL ON FUNCTION public.kit_documento_escopo_imutavel() TO postgres;
GRANT ALL ON FUNCTION public.kit_documento_escopo_imutavel() TO service_role;


--
-- Name: FUNCTION limite_cnpjs_operacao(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.limite_cnpjs_operacao() FROM PUBLIC;
GRANT ALL ON FUNCTION public.limite_cnpjs_operacao() TO postgres;
GRANT ALL ON FUNCTION public.limite_cnpjs_operacao() TO authenticated;
GRANT ALL ON FUNCTION public.limite_cnpjs_operacao() TO service_role;


--
-- Name: FUNCTION listar_acessos_empresa_operacao(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.listar_acessos_empresa_operacao() FROM PUBLIC;
GRANT ALL ON FUNCTION public.listar_acessos_empresa_operacao() TO postgres;
GRANT ALL ON FUNCTION public.listar_acessos_empresa_operacao() TO authenticated;
GRANT ALL ON FUNCTION public.listar_acessos_empresa_operacao() TO service_role;


--
-- Name: FUNCTION listar_convites_empresa_operacao(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.listar_convites_empresa_operacao() FROM PUBLIC;
GRANT ALL ON FUNCTION public.listar_convites_empresa_operacao() TO postgres;
GRANT ALL ON FUNCTION public.listar_convites_empresa_operacao() TO authenticated;
GRANT ALL ON FUNCTION public.listar_convites_empresa_operacao() TO service_role;


--
-- Name: FUNCTION listar_empresas_convite_operacao(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.listar_empresas_convite_operacao() FROM PUBLIC;
GRANT ALL ON FUNCTION public.listar_empresas_convite_operacao() TO postgres;
GRANT ALL ON FUNCTION public.listar_empresas_convite_operacao() TO authenticated;
GRANT ALL ON FUNCTION public.listar_empresas_convite_operacao() TO service_role;


--
-- Name: FUNCTION meu_acesso_operacao(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.meu_acesso_operacao() FROM PUBLIC;
GRANT ALL ON FUNCTION public.meu_acesso_operacao() TO postgres;
GRANT ALL ON FUNCTION public.meu_acesso_operacao() TO authenticated;
GRANT ALL ON FUNCTION public.meu_acesso_operacao() TO service_role;


--
-- Name: FUNCTION oportunidades_para_dossies(p_versao integer, p_max_tentativas integer, p_desde date, p_hoje date, p_limite integer); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.oportunidades_para_dossies(p_versao integer, p_max_tentativas integer, p_desde date, p_hoje date, p_limite integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.oportunidades_para_dossies(p_versao integer, p_max_tentativas integer, p_desde date, p_hoje date, p_limite integer) TO postgres;
GRANT ALL ON FUNCTION public.oportunidades_para_dossies(p_versao integer, p_max_tentativas integer, p_desde date, p_hoje date, p_limite integer) TO service_role;


--
-- Name: FUNCTION pode_acessar_empresa_operacao(p_org uuid, p_empresa uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.pode_acessar_empresa_operacao(p_org uuid, p_empresa uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pode_acessar_empresa_operacao(p_org uuid, p_empresa uuid) TO postgres;
GRANT ALL ON FUNCTION public.pode_acessar_empresa_operacao(p_org uuid, p_empresa uuid) TO authenticated;
GRANT ALL ON FUNCTION public.pode_acessar_empresa_operacao(p_org uuid, p_empresa uuid) TO service_role;


--
-- Name: FUNCTION pode_acessar_processo_operacao(p_org uuid, p_processo uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.pode_acessar_processo_operacao(p_org uuid, p_processo uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pode_acessar_processo_operacao(p_org uuid, p_processo uuid) TO postgres;
GRANT ALL ON FUNCTION public.pode_acessar_processo_operacao(p_org uuid, p_processo uuid) TO authenticated;
GRANT ALL ON FUNCTION public.pode_acessar_processo_operacao(p_org uuid, p_processo uuid) TO service_role;


--
-- Name: FUNCTION pode_escrever_empresa_operacao(p_org uuid, p_empresa uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.pode_escrever_empresa_operacao(p_org uuid, p_empresa uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pode_escrever_empresa_operacao(p_org uuid, p_empresa uuid) TO postgres;
GRANT ALL ON FUNCTION public.pode_escrever_empresa_operacao(p_org uuid, p_empresa uuid) TO authenticated;
GRANT ALL ON FUNCTION public.pode_escrever_empresa_operacao(p_org uuid, p_empresa uuid) TO service_role;


--
-- Name: FUNCTION pode_escrever_org_operacao(p_org uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.pode_escrever_org_operacao(p_org uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pode_escrever_org_operacao(p_org uuid) TO postgres;
GRANT ALL ON FUNCTION public.pode_escrever_org_operacao(p_org uuid) TO authenticated;
GRANT ALL ON FUNCTION public.pode_escrever_org_operacao(p_org uuid) TO service_role;


--
-- Name: FUNCTION pode_escrever_processo_operacao(p_org uuid, p_processo uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.pode_escrever_processo_operacao(p_org uuid, p_processo uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pode_escrever_processo_operacao(p_org uuid, p_processo uuid) TO postgres;
GRANT ALL ON FUNCTION public.pode_escrever_processo_operacao(p_org uuid, p_processo uuid) TO authenticated;
GRANT ALL ON FUNCTION public.pode_escrever_processo_operacao(p_org uuid, p_processo uuid) TO service_role;


--
-- Name: FUNCTION preservar_escopo_operacao(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.preservar_escopo_operacao() FROM PUBLIC;
GRANT ALL ON FUNCTION public.preservar_escopo_operacao() TO postgres;
GRANT ALL ON FUNCTION public.preservar_escopo_operacao() TO service_role;


--
-- Name: FUNCTION proteger_status_cliente_operacao(); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.proteger_status_cliente_operacao() TO postgres;
GRANT ALL ON FUNCTION public.proteger_status_cliente_operacao() TO anon;
GRANT ALL ON FUNCTION public.proteger_status_cliente_operacao() TO authenticated;
GRANT ALL ON FUNCTION public.proteger_status_cliente_operacao() TO service_role;


--
-- Name: FUNCTION resumo_inteligencia_mercado(p_termos text[], p_dias integer, p_uf text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.resumo_inteligencia_mercado(p_termos text[], p_dias integer, p_uf text) TO postgres;
GRANT ALL ON FUNCTION public.resumo_inteligencia_mercado(p_termos text[], p_dias integer, p_uf text) TO anon;
GRANT ALL ON FUNCTION public.resumo_inteligencia_mercado(p_termos text[], p_dias integer, p_uf text) TO authenticated;
GRANT ALL ON FUNCTION public.resumo_inteligencia_mercado(p_termos text[], p_dias integer, p_uf text) TO service_role;


--
-- Name: FUNCTION revogar_acesso_empresa_operacao(p_usuario_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.revogar_acesso_empresa_operacao(p_usuario_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revogar_acesso_empresa_operacao(p_usuario_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.revogar_acesso_empresa_operacao(p_usuario_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.revogar_acesso_empresa_operacao(p_usuario_id uuid) TO service_role;


--
-- Name: FUNCTION revogar_convite_empresa_operacao(p_convite_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.revogar_convite_empresa_operacao(p_convite_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revogar_convite_empresa_operacao(p_convite_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.revogar_convite_empresa_operacao(p_convite_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.revogar_convite_empresa_operacao(p_convite_id uuid) TO service_role;


--
-- Name: FUNCTION set_limit(real); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.set_limit(real) TO postgres;
GRANT ALL ON FUNCTION public.set_limit(real) TO anon;
GRANT ALL ON FUNCTION public.set_limit(real) TO authenticated;
GRANT ALL ON FUNCTION public.set_limit(real) TO service_role;


--
-- Name: FUNCTION show_limit(); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.show_limit() TO postgres;
GRANT ALL ON FUNCTION public.show_limit() TO anon;
GRANT ALL ON FUNCTION public.show_limit() TO authenticated;
GRANT ALL ON FUNCTION public.show_limit() TO service_role;


--
-- Name: FUNCTION show_trgm(text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.show_trgm(text) TO postgres;
GRANT ALL ON FUNCTION public.show_trgm(text) TO anon;
GRANT ALL ON FUNCTION public.show_trgm(text) TO authenticated;
GRANT ALL ON FUNCTION public.show_trgm(text) TO service_role;


--
-- Name: FUNCTION similarity(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.similarity(text, text) TO postgres;
GRANT ALL ON FUNCTION public.similarity(text, text) TO anon;
GRANT ALL ON FUNCTION public.similarity(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.similarity(text, text) TO service_role;


--
-- Name: FUNCTION similarity_dist(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.similarity_dist(text, text) TO postgres;
GRANT ALL ON FUNCTION public.similarity_dist(text, text) TO anon;
GRANT ALL ON FUNCTION public.similarity_dist(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.similarity_dist(text, text) TO service_role;


--
-- Name: FUNCTION similarity_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.similarity_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.similarity_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.similarity_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.similarity_op(text, text) TO service_role;


--
-- Name: FUNCTION strict_word_similarity(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.strict_word_similarity(text, text) TO postgres;
GRANT ALL ON FUNCTION public.strict_word_similarity(text, text) TO anon;
GRANT ALL ON FUNCTION public.strict_word_similarity(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.strict_word_similarity(text, text) TO service_role;


--
-- Name: FUNCTION strict_word_similarity_commutator_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.strict_word_similarity_commutator_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.strict_word_similarity_commutator_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.strict_word_similarity_commutator_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.strict_word_similarity_commutator_op(text, text) TO service_role;


--
-- Name: FUNCTION strict_word_similarity_dist_commutator_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.strict_word_similarity_dist_commutator_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.strict_word_similarity_dist_commutator_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.strict_word_similarity_dist_commutator_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.strict_word_similarity_dist_commutator_op(text, text) TO service_role;


--
-- Name: FUNCTION strict_word_similarity_dist_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.strict_word_similarity_dist_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.strict_word_similarity_dist_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.strict_word_similarity_dist_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.strict_word_similarity_dist_op(text, text) TO service_role;


--
-- Name: FUNCTION strict_word_similarity_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.strict_word_similarity_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.strict_word_similarity_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.strict_word_similarity_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.strict_word_similarity_op(text, text) TO service_role;


--
-- Name: FUNCTION tem_vinculo_operacao(p_organizacao_id uuid); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.tem_vinculo_operacao(p_organizacao_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.tem_vinculo_operacao(p_organizacao_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.tem_vinculo_operacao(p_organizacao_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.tem_vinculo_operacao(p_organizacao_id uuid) TO service_role;


--
-- Name: FUNCTION validar_arquivo_processo_operacao(); Type: ACL; Schema: public; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION public.validar_arquivo_processo_operacao() FROM PUBLIC;
GRANT ALL ON FUNCTION public.validar_arquivo_processo_operacao() TO postgres;
GRANT ALL ON FUNCTION public.validar_arquivo_processo_operacao() TO service_role;


--
-- Name: FUNCTION verificar_limite_cnpjs_operacao(); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.verificar_limite_cnpjs_operacao() TO postgres;
GRANT ALL ON FUNCTION public.verificar_limite_cnpjs_operacao() TO anon;
GRANT ALL ON FUNCTION public.verificar_limite_cnpjs_operacao() TO authenticated;
GRANT ALL ON FUNCTION public.verificar_limite_cnpjs_operacao() TO service_role;


--
-- Name: FUNCTION word_similarity(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.word_similarity(text, text) TO postgres;
GRANT ALL ON FUNCTION public.word_similarity(text, text) TO anon;
GRANT ALL ON FUNCTION public.word_similarity(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.word_similarity(text, text) TO service_role;


--
-- Name: FUNCTION word_similarity_commutator_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.word_similarity_commutator_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.word_similarity_commutator_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.word_similarity_commutator_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.word_similarity_commutator_op(text, text) TO service_role;


--
-- Name: FUNCTION word_similarity_dist_commutator_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.word_similarity_dist_commutator_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.word_similarity_dist_commutator_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.word_similarity_dist_commutator_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.word_similarity_dist_commutator_op(text, text) TO service_role;


--
-- Name: FUNCTION word_similarity_dist_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.word_similarity_dist_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.word_similarity_dist_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.word_similarity_dist_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.word_similarity_dist_op(text, text) TO service_role;


--
-- Name: FUNCTION word_similarity_op(text, text); Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION public.word_similarity_op(text, text) TO postgres;
GRANT ALL ON FUNCTION public.word_similarity_op(text, text) TO anon;
GRANT ALL ON FUNCTION public.word_similarity_op(text, text) TO authenticated;
GRANT ALL ON FUNCTION public.word_similarity_op(text, text) TO service_role;


--
-- Name: TABLE audit_log_entries; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.audit_log_entries TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.audit_log_entries TO postgres;
GRANT SELECT ON TABLE auth.audit_log_entries TO postgres WITH GRANT OPTION;


--
-- Name: TABLE custom_oauth_providers; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.custom_oauth_providers TO postgres;
GRANT ALL ON TABLE auth.custom_oauth_providers TO dashboard_user;


--
-- Name: TABLE flow_state; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.flow_state TO postgres;
GRANT SELECT ON TABLE auth.flow_state TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.flow_state TO dashboard_user;


--
-- Name: TABLE identities; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.identities TO postgres;
GRANT SELECT ON TABLE auth.identities TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.identities TO dashboard_user;


--
-- Name: TABLE instances; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.instances TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.instances TO postgres;
GRANT SELECT ON TABLE auth.instances TO postgres WITH GRANT OPTION;


--
-- Name: TABLE mfa_amr_claims; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_amr_claims TO postgres;
GRANT SELECT ON TABLE auth.mfa_amr_claims TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_amr_claims TO dashboard_user;


--
-- Name: TABLE mfa_challenges; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_challenges TO postgres;
GRANT SELECT ON TABLE auth.mfa_challenges TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_challenges TO dashboard_user;


--
-- Name: TABLE mfa_factors; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_factors TO postgres;
GRANT SELECT ON TABLE auth.mfa_factors TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_factors TO dashboard_user;


--
-- Name: TABLE mfa_recovery_code_sets; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.mfa_recovery_code_sets TO postgres;
GRANT ALL ON TABLE auth.mfa_recovery_code_sets TO dashboard_user;


--
-- Name: TABLE mfa_recovery_codes; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.mfa_recovery_codes TO postgres;
GRANT ALL ON TABLE auth.mfa_recovery_codes TO dashboard_user;


--
-- Name: TABLE oauth_authorizations; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_authorizations TO postgres;
GRANT ALL ON TABLE auth.oauth_authorizations TO dashboard_user;


--
-- Name: TABLE oauth_client_states; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_client_states TO postgres;
GRANT ALL ON TABLE auth.oauth_client_states TO dashboard_user;


--
-- Name: TABLE oauth_clients; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_clients TO postgres;
GRANT ALL ON TABLE auth.oauth_clients TO dashboard_user;


--
-- Name: TABLE oauth_consents; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_consents TO postgres;
GRANT ALL ON TABLE auth.oauth_consents TO dashboard_user;


--
-- Name: TABLE one_time_tokens; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.one_time_tokens TO postgres;
GRANT SELECT ON TABLE auth.one_time_tokens TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.one_time_tokens TO dashboard_user;


--
-- Name: TABLE refresh_tokens; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.refresh_tokens TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.refresh_tokens TO postgres;
GRANT SELECT ON TABLE auth.refresh_tokens TO postgres WITH GRANT OPTION;


--
-- Name: SEQUENCE refresh_tokens_id_seq; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON SEQUENCE auth.refresh_tokens_id_seq TO dashboard_user;
GRANT ALL ON SEQUENCE auth.refresh_tokens_id_seq TO postgres;


--
-- Name: TABLE saml_providers; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.saml_providers TO postgres;
GRANT SELECT ON TABLE auth.saml_providers TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.saml_providers TO dashboard_user;


--
-- Name: TABLE saml_relay_states; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.saml_relay_states TO postgres;
GRANT SELECT ON TABLE auth.saml_relay_states TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.saml_relay_states TO dashboard_user;


--
-- Name: TABLE schema_migrations; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT SELECT ON TABLE auth.schema_migrations TO postgres WITH GRANT OPTION;


--
-- Name: TABLE scim_tokens; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.scim_tokens TO postgres;
GRANT ALL ON TABLE auth.scim_tokens TO dashboard_user;


--
-- Name: TABLE scim_users; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.scim_users TO postgres;
GRANT ALL ON TABLE auth.scim_users TO dashboard_user;


--
-- Name: TABLE sessions; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sessions TO postgres;
GRANT SELECT ON TABLE auth.sessions TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sessions TO dashboard_user;


--
-- Name: TABLE sso_domains; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sso_domains TO postgres;
GRANT SELECT ON TABLE auth.sso_domains TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sso_domains TO dashboard_user;


--
-- Name: TABLE sso_providers; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sso_providers TO postgres;
GRANT SELECT ON TABLE auth.sso_providers TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sso_providers TO dashboard_user;


--
-- Name: TABLE users; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.users TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.users TO postgres;
GRANT SELECT ON TABLE auth.users TO postgres WITH GRANT OPTION;


--
-- Name: TABLE webauthn_challenges; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.webauthn_challenges TO postgres;
GRANT ALL ON TABLE auth.webauthn_challenges TO dashboard_user;


--
-- Name: TABLE webauthn_credentials; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.webauthn_credentials TO postgres;
GRANT ALL ON TABLE auth.webauthn_credentials TO dashboard_user;


--
-- Name: TABLE admins; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.admins TO postgres;
GRANT ALL ON TABLE public.admins TO anon;
GRANT ALL ON TABLE public.admins TO authenticated;
GRANT ALL ON TABLE public.admins TO service_role;


--
-- Name: TABLE clientes; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.clientes TO postgres;
GRANT ALL ON TABLE public.clientes TO anon;
GRANT ALL ON TABLE public.clientes TO authenticated;
GRANT ALL ON TABLE public.clientes TO service_role;


--
-- Name: TABLE comprasgov_resultados; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.comprasgov_resultados TO postgres;
GRANT ALL ON TABLE public.comprasgov_resultados TO anon;
GRANT ALL ON TABLE public.comprasgov_resultados TO authenticated;
GRANT ALL ON TABLE public.comprasgov_resultados TO service_role;


--
-- Name: TABLE contratos; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.contratos TO postgres;
GRANT ALL ON TABLE public.contratos TO anon;
GRANT ALL ON TABLE public.contratos TO authenticated;
GRANT ALL ON TABLE public.contratos TO service_role;


--
-- Name: TABLE dados_robo; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.dados_robo TO postgres;
GRANT ALL ON TABLE public.dados_robo TO anon;
GRANT ALL ON TABLE public.dados_robo TO authenticated;
GRANT ALL ON TABLE public.dados_robo TO service_role;


--
-- Name: TABLE dossies_editais; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.dossies_editais TO postgres;
GRANT ALL ON TABLE public.dossies_editais TO anon;
GRANT ALL ON TABLE public.dossies_editais TO authenticated;
GRANT ALL ON TABLE public.dossies_editais TO service_role;


--
-- Name: TABLE fila_dossies; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.fila_dossies TO postgres;
GRANT ALL ON TABLE public.fila_dossies TO anon;
GRANT ALL ON TABLE public.fila_dossies TO authenticated;
GRANT ALL ON TABLE public.fila_dossies TO service_role;


--
-- Name: TABLE lembretes; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.lembretes TO postgres;
GRANT ALL ON TABLE public.lembretes TO anon;
GRANT ALL ON TABLE public.lembretes TO authenticated;
GRANT ALL ON TABLE public.lembretes TO service_role;


--
-- Name: TABLE logs_boletim; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.logs_boletim TO postgres;
GRANT ALL ON TABLE public.logs_boletim TO anon;
GRANT ALL ON TABLE public.logs_boletim TO authenticated;
GRANT ALL ON TABLE public.logs_boletim TO service_role;


--
-- Name: TABLE mercado_atas; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.mercado_atas TO postgres;
GRANT ALL ON TABLE public.mercado_atas TO anon;
GRANT ALL ON TABLE public.mercado_atas TO authenticated;
GRANT ALL ON TABLE public.mercado_atas TO service_role;


--
-- Name: TABLE operacao_agenda; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_agenda TO postgres;
GRANT ALL ON TABLE public.operacao_agenda TO anon;
GRANT ALL ON TABLE public.operacao_agenda TO authenticated;
GRANT ALL ON TABLE public.operacao_agenda TO service_role;


--
-- Name: TABLE operacao_anexos_processo; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_anexos_processo TO postgres;
GRANT ALL ON TABLE public.operacao_anexos_processo TO anon;
GRANT ALL ON TABLE public.operacao_anexos_processo TO authenticated;
GRANT ALL ON TABLE public.operacao_anexos_processo TO service_role;


--
-- Name: TABLE operacao_contratos; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_contratos TO postgres;
GRANT ALL ON TABLE public.operacao_contratos TO anon;
GRANT ALL ON TABLE public.operacao_contratos TO authenticated;
GRANT ALL ON TABLE public.operacao_contratos TO service_role;


--
-- Name: TABLE operacao_convites_empresa; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_convites_empresa TO postgres;
GRANT ALL ON TABLE public.operacao_convites_empresa TO service_role;


--
-- Name: TABLE operacao_documentos; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_documentos TO postgres;
GRANT ALL ON TABLE public.operacao_documentos TO anon;
GRANT ALL ON TABLE public.operacao_documentos TO authenticated;
GRANT ALL ON TABLE public.operacao_documentos TO service_role;


--
-- Name: TABLE operacao_empenhos; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_empenhos TO postgres;
GRANT ALL ON TABLE public.operacao_empenhos TO anon;
GRANT ALL ON TABLE public.operacao_empenhos TO authenticated;
GRANT ALL ON TABLE public.operacao_empenhos TO service_role;


--
-- Name: TABLE operacao_empresas; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_empresas TO postgres;
GRANT ALL ON TABLE public.operacao_empresas TO anon;
GRANT ALL ON TABLE public.operacao_empresas TO authenticated;
GRANT ALL ON TABLE public.operacao_empresas TO service_role;


--
-- Name: TABLE operacao_itens_resultado; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_itens_resultado TO postgres;
GRANT ALL ON TABLE public.operacao_itens_resultado TO anon;
GRANT ALL ON TABLE public.operacao_itens_resultado TO authenticated;
GRANT ALL ON TABLE public.operacao_itens_resultado TO service_role;


--
-- Name: TABLE operacao_limites_cnpj; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_limites_cnpj TO postgres;
GRANT ALL ON TABLE public.operacao_limites_cnpj TO service_role;


--
-- Name: TABLE operacao_membros; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_membros TO postgres;
GRANT ALL ON TABLE public.operacao_membros TO anon;
GRANT ALL ON TABLE public.operacao_membros TO authenticated;
GRANT ALL ON TABLE public.operacao_membros TO service_role;


--
-- Name: TABLE operacao_ocorrencias; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_ocorrencias TO postgres;
GRANT ALL ON TABLE public.operacao_ocorrencias TO anon;
GRANT ALL ON TABLE public.operacao_ocorrencias TO authenticated;
GRANT ALL ON TABLE public.operacao_ocorrencias TO service_role;


--
-- Name: TABLE operacao_organizacoes; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_organizacoes TO postgres;
GRANT ALL ON TABLE public.operacao_organizacoes TO anon;
GRANT ALL ON TABLE public.operacao_organizacoes TO authenticated;
GRANT ALL ON TABLE public.operacao_organizacoes TO service_role;


--
-- Name: TABLE operacao_prazos_processo; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_prazos_processo TO postgres;
GRANT ALL ON TABLE public.operacao_prazos_processo TO anon;
GRANT ALL ON TABLE public.operacao_prazos_processo TO authenticated;
GRANT ALL ON TABLE public.operacao_prazos_processo TO service_role;


--
-- Name: TABLE operacao_processos; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_processos TO postgres;
GRANT ALL ON TABLE public.operacao_processos TO anon;
GRANT ALL ON TABLE public.operacao_processos TO authenticated;
GRANT ALL ON TABLE public.operacao_processos TO service_role;


--
-- Name: TABLE operacao_renovacoes_documento; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_renovacoes_documento TO postgres;
GRANT ALL ON TABLE public.operacao_renovacoes_documento TO anon;
GRANT ALL ON TABLE public.operacao_renovacoes_documento TO authenticated;
GRANT ALL ON TABLE public.operacao_renovacoes_documento TO service_role;


--
-- Name: TABLE operacao_tipos_documento; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.operacao_tipos_documento TO postgres;
GRANT ALL ON TABLE public.operacao_tipos_documento TO anon;
GRANT ALL ON TABLE public.operacao_tipos_documento TO authenticated;
GRANT ALL ON TABLE public.operacao_tipos_documento TO service_role;


--
-- Name: TABLE oportunidades_abertas; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.oportunidades_abertas TO postgres;
GRANT ALL ON TABLE public.oportunidades_abertas TO anon;
GRANT ALL ON TABLE public.oportunidades_abertas TO authenticated;
GRANT ALL ON TABLE public.oportunidades_abertas TO service_role;


--
-- Name: TABLE uso_diario; Type: ACL; Schema: public; Owner: supabase_admin
--

GRANT ALL ON TABLE public.uso_diario TO postgres;
GRANT ALL ON TABLE public.uso_diario TO anon;
GRANT ALL ON TABLE public.uso_diario TO authenticated;
GRANT ALL ON TABLE public.uso_diario TO service_role;


--
-- Name: TABLE buckets; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.buckets TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE storage.buckets TO service_role;
GRANT ALL ON TABLE storage.buckets TO authenticated;
GRANT ALL ON TABLE storage.buckets TO anon;


--
-- Name: TABLE buckets_analytics; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.buckets_analytics TO service_role;
GRANT ALL ON TABLE storage.buckets_analytics TO authenticated;
GRANT ALL ON TABLE storage.buckets_analytics TO anon;


--
-- Name: TABLE buckets_vectors; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT SELECT ON TABLE storage.buckets_vectors TO service_role;
GRANT SELECT ON TABLE storage.buckets_vectors TO authenticated;
GRANT SELECT ON TABLE storage.buckets_vectors TO anon;


--
-- Name: TABLE iceberg_namespaces; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.iceberg_namespaces TO service_role;
GRANT SELECT ON TABLE storage.iceberg_namespaces TO authenticated;
GRANT SELECT ON TABLE storage.iceberg_namespaces TO anon;


--
-- Name: TABLE iceberg_tables; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.iceberg_tables TO service_role;
GRANT SELECT ON TABLE storage.iceberg_tables TO authenticated;
GRANT SELECT ON TABLE storage.iceberg_tables TO anon;


--
-- Name: TABLE objects; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.objects TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE storage.objects TO service_role;
GRANT ALL ON TABLE storage.objects TO authenticated;
GRANT ALL ON TABLE storage.objects TO anon;


--
-- Name: TABLE s3_multipart_uploads; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.s3_multipart_uploads TO service_role;
GRANT SELECT ON TABLE storage.s3_multipart_uploads TO authenticated;
GRANT SELECT ON TABLE storage.s3_multipart_uploads TO anon;


--
-- Name: TABLE s3_multipart_uploads_parts; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.s3_multipart_uploads_parts TO service_role;
GRANT SELECT ON TABLE storage.s3_multipart_uploads_parts TO authenticated;
GRANT SELECT ON TABLE storage.s3_multipart_uploads_parts TO anon;


--
-- Name: TABLE vector_indexes; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT SELECT ON TABLE storage.vector_indexes TO service_role;
GRANT SELECT ON TABLE storage.vector_indexes TO authenticated;
GRANT SELECT ON TABLE storage.vector_indexes TO anon;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: auth; Owner: supabase_auth_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: auth; Owner: supabase_auth_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: auth; Owner: supabase_auth_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: extensions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions GRANT ALL ON SEQUENCES TO postgres WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: extensions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions GRANT ALL ON FUNCTIONS TO postgres WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: extensions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions GRANT ALL ON TABLES TO postgres WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: storage; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: storage; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: storage; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict lEj89PqkwhJtrjZiv3o8MhK0BiO2jVXvg83H9SrdfR1BodZIM6s8fw4UjpcTJXs

