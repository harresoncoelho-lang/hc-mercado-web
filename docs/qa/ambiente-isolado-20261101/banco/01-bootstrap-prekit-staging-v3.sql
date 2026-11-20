-- CANDIDATO STAGING; REVISÃO INDEPENDENTE ANTES DE APLICAR.
-- Único alvo: luguscapasskcsficckf / organização vhmjospwgiryrnrndkpd (Free).
-- Conferir a URL/identidade da conexão; rótulo em SQL não prova project_ref.
-- Nenhum dado copiado. Não executar em produção ou reaplicar após commit.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;
lock table auth.users,storage.objects,storage.buckets in access exclusive mode;
do $pre_bootstrap$
declare observado jsonb;
begin
 if current_user<>'postgres' or current_database()<>'postgres' or current_setting('server_version_num')<>'170011' then raise exception 'Executor/banco/versão fora do staging aprovado';end if;
 with
relacoes as (
 select c.*,n.nspname as esquema from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p','v','m','f','S') and ((n.nspname='public' and (c.relname like 'operacao\_%' escape '\' or c.relname in ('clientes','admins')))
    or (n.nspname='auth' and c.relname='users')
    or (n.nspname='storage' and c.relname in ('objects','buckets')))
), funcoes as (
 select p.*,n.nspname as esquema from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.prokind in ('f','p') and (
  (n.nspname='public' and (p.proname like '%operacao%' or p.proname like '%identificacao_empresa%' or p.proname in ('gravar_kit_documento','kit_documento_escopo_imutavel','configurar_limite_cnpjs_cliente','consultar_limite_cnpjs_cliente')))
  or (n.nspname='auth' and p.proname='uid')
  or p.oid in (select t.tgfoid from pg_trigger t join relacoes r on r.oid=t.tgrelid where not t.tgisinternal)
 )
), secoes as (
 select 'relacoes' as secao,coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'nome',r.relname,'tipo',r.relkind,'dono',pg_get_userbyid(r.relowner),
  'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity,'opcoes',r.reloptions,
  'acl',r.relacl::text) order by r.esquema,r.relname),'[]'::jsonb) as itens from relacoes r
 union all
 select 'colunas',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'ordem',a.attnum,'nome',a.attname,
  'tipo',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
  'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),
  'acl',a.attacl::text) order by r.esquema,r.relname,a.attnum),'[]'::jsonb)
 from relacoes r join pg_attribute a on a.attrelid=r.oid and a.attnum>0 and not a.attisdropped
 left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where r.relkind in ('r','p','v','m','f')
 union all
 select 'constraints',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',c.conname,'tipo',c.contype,
  'validada',c.convalidated,'deferivel',c.condeferrable,'adiada',c.condeferred,
  'definicao',pg_get_constraintdef(c.oid,true)) order by r.esquema,r.relname,c.conname),'[]'::jsonb)
 from relacoes r join pg_constraint c on c.conrelid=r.oid
 union all
 select 'indices',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',ci.relname,'unico',i.indisunique,
  'valido',i.indisvalid,'pronto',i.indisready,'primario',i.indisprimary,
  'definicao',pg_get_indexdef(i.indexrelid)) order by r.esquema,r.relname,ci.relname),'[]'::jsonb)
 from relacoes r join pg_index i on i.indrelid=r.oid join pg_class ci on ci.oid=i.indexrelid
 union all
 select 'policies',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',schemaname,'tabela',tablename,'nome',policyname,'permissiva',permissive,
  'papeis',roles,'comando',cmd,'using',qual,'check',with_check)
  order by schemaname,tablename,policyname),'[]'::jsonb)
 from pg_policies where (schemaname='public' and (tablename like 'operacao\_%' escape '\' or tablename in ('clientes','admins')))
  or (schemaname='storage' and tablename in ('objects','buckets')) or (schemaname='auth' and tablename='users')
 union all
 select 'triggers',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',t.tgname,'habilitado',t.tgenabled,
  'funcao',t.tgfoid::regprocedure::text,'definicao',pg_get_triggerdef(t.oid,true))
  order by r.esquema,r.relname,t.tgname),'[]'::jsonb)
 from relacoes r join pg_trigger t on t.tgrelid=r.oid where not t.tgisinternal
 union all
 select 'funcoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',f.esquema,'nome',f.proname,'assinatura',f.oid::regprocedure::text,
  'argumentos',pg_get_function_identity_arguments(f.oid),'retorno',pg_get_function_result(f.oid),
  'dono',pg_get_userbyid(f.proowner),'security_definer',f.prosecdef,'volatilidade',f.provolatile,
  'strict',f.proisstrict,'configuracao',f.proconfig,'acl',f.proacl::text,
  'hash_corpo_md5',md5(replace(f.prosrc,chr(13),'')),
  'definicao',case when f.esquema='public' and (f.proname like '%operacao%' or f.proname like '%identificacao_empresa%' or f.proname in ('gravar_kit_documento','kit_documento_escopo_imutavel','configurar_limite_cnpjs_cliente','consultar_limite_cnpjs_cliente')) then pg_get_functiondef(f.oid) else null end)
  order by f.esquema,f.oid::regprocedure::text),'[]'::jsonb) from funcoes f
 union all
 select 'acl_relacoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'objeto',r.relname,'concedente',pg_get_userbyid(a.grantor),
  'papel',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilegio',a.privilege_type,'grant_option',a.is_grantable)
  order by r.esquema,r.relname,a.grantee,a.privilege_type),'[]'::jsonb)
 from relacoes r cross join lateral aclexplode(coalesce(r.relacl,acldefault(case when r.relkind='S' then 's'::"char" else 'r'::"char" end,r.relowner))) a
 union all
 select 'acl_funcoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',f.esquema,'objeto',f.oid::regprocedure::text,'concedente',pg_get_userbyid(a.grantor),
  'papel',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilegio',a.privilege_type,'grant_option',a.is_grantable)
  order by f.esquema,f.oid::regprocedure::text,a.grantee,a.privilege_type),'[]'::jsonb)
 from funcoes f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
 union all
 select 'schemas',coalesce(jsonb_agg(jsonb_build_object('nome',nspname,'dono',pg_get_userbyid(nspowner),'acl',nspacl::text) order by nspname),'[]'::jsonb)
 from pg_namespace where nspname in ('public','auth','storage')
 union all
 select 'defaults_acl',coalesce(jsonb_agg(jsonb_build_object('dono',pg_get_userbyid(d.defaclrole),
  'esquema',coalesce(n.nspname,'*'),'tipo',d.defaclobjtype,'acl',d.defaclacl::text)
  order by d.defaclrole,d.defaclnamespace,d.defaclobjtype),'[]'::jsonb)
 from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
 where d.defaclnamespace=0 or n.nspname in ('public','auth','storage')
 union all
 select 'papeis',coalesce(jsonb_agg(jsonb_build_object('nome',rolname,'superuser',rolsuper,
  'inherit',rolinherit,'login',rolcanlogin,'create_role',rolcreaterole,'bypass_rls',rolbypassrls) order by rolname),'[]'::jsonb) from pg_roles
 union all
 select 'membros_papeis',coalesce(jsonb_agg(jsonb_build_object('papel',pg_get_userbyid(m.roleid),
  'membro',pg_get_userbyid(m.member),'concedente',pg_get_userbyid(m.grantor),'admin_option',m.admin_option,
  'inherit_option',to_jsonb(m)->'inherit_option','set_option',to_jsonb(m)->'set_option')
  order by m.roleid,m.member),'[]'::jsonb) from pg_auth_members m
 union all
 select 'dependencias_entrada',coalesce(jsonb_agg(jsonb_build_object(
  'objeto',pg_describe_object(d.classid,d.objid,d.objsubid),
  'referencia',pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid),'tipo',d.deptype)
  order by d.classid,d.objid,d.objsubid,d.refobjid,d.refobjsubid),'[]'::jsonb)
 from pg_depend d where (d.refclassid='pg_class'::regclass and d.refobjid in (select oid from relacoes))
  or (d.refclassid='pg_proc'::regclass and d.refobjid in (select oid from funcoes))
), catalogo as (select jsonb_object_agg(secao,itens order by secao) as corpo from secoes)

 select corpo into observado from catalogo;
 if md5(observado::text)<>'785cf53d0d88df117eff15085f879018' then raise exception 'Catálogo vazio de staging divergente; abortar sem contornar guarda';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','f','S')) or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')) then raise exception 'Schema public não está vazio';end if;
 if exists(select 1 from auth.users) or exists(select 1 from storage.objects) or exists(select 1 from storage.buckets) then raise exception 'Destino já contém dados de Auth/Storage';end if;
end
$pre_bootstrap$;

CREATE TABLE public."admins" (
 "email" text NOT NULL,
 "nome" text,
 "role" text DEFAULT 'membro'::text NOT NULL,
 "permissoes" jsonb DEFAULT '[]'::jsonb NOT NULL,
 "criado_em" timestamp with time zone DEFAULT now() NOT NULL,
 "criado_por" text
);

ALTER TABLE public."admins" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."clientes" (
 "id" uuid NOT NULL,
 "nome" text NOT NULL,
 "empresa" text,
 "cnpj" text,
 "telefone" text,
 "email" text NOT NULL,
 "status" text DEFAULT 'pendente'::text NOT NULL,
 "plano" text,
 "observacoes_admin" text,
 "criado_em" timestamp with time zone DEFAULT now() NOT NULL,
 "aprovado_em" timestamp with time zone,
 "aprovado_por" text,
 "segmento" jsonb DEFAULT '[]'::jsonb,
 "cargo" text,
 "porte_empresa" text,
 "aceite_termos" boolean DEFAULT false,
 "aceite_termos_em" timestamp with time zone,
 "atividades" text,
 "estados_interesse" jsonb DEFAULT '[]'::jsonb NOT NULL,
 "como_conheceu" text,
 "quantidade_funcionarios" text,
 "licitacoes_por_mes" text,
 "faturamento_anual" text,
 "como_pretende_usar" text,
 "boletim_filtro" jsonb
);

ALTER TABLE public."clientes" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_agenda" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "organizacao_id" uuid NOT NULL,
 "empresa_id" uuid,
 "categoria" text NOT NULL,
 "titulo" text NOT NULL,
 "vencimento" timestamp with time zone NOT NULL,
 "responsavel" text,
 "observacoes" text,
 "concluido_em" timestamp with time zone,
 "criado_em" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."operacao_agenda" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_anexos_processo" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "organizacao_id" uuid NOT NULL,
 "processo_id" uuid NOT NULL,
 "tipo" text NOT NULL,
 "titulo" text NOT NULL,
 "referencia_numero" text,
 "arquivo_caminho" text NOT NULL,
 "arquivo_nome" text NOT NULL,
 "criado_em" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."operacao_anexos_processo" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_contratos" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "organizacao_id" uuid NOT NULL,
 "processo_id" uuid NOT NULL,
 "numero" text NOT NULL,
 "assinado_em" date,
 "vigencia_inicio" date,
 "vigencia_fim" date,
 "valor" numeric(15,2),
 "situacao" text DEFAULT 'a_assinar'::text NOT NULL,
 "observacoes" text,
 "criado_em" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."operacao_contratos" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_convites_empresa" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "organizacao_id" uuid NOT NULL,
 "empresa_id" uuid NOT NULL,
 "email" text NOT NULL,
 "nome" text NOT NULL,
 "token" uuid DEFAULT gen_random_uuid() NOT NULL,
 "expira_em" timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
 "aceito_em" timestamp with time zone,
 "revogado_em" timestamp with time zone,
 "criado_por" uuid NOT NULL,
 "criado_em" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."operacao_convites_empresa" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_documentos" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "organizacao_id" uuid NOT NULL,
 "empresa_id" uuid NOT NULL,
 "tipo" text NOT NULL,
 "titulo" text,
 "emissao" date,
 "vencimento" date,
 "orgao_emissor" text,
 "responsavel" text,
 "observacoes" text,
 "arquivo_caminho" text,
 "arquivo_nome" text,
 "criado_por" uuid,
 "criado_em" timestamp with time zone DEFAULT now() NOT NULL,
 "atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."operacao_documentos" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_empenhos" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "organizacao_id" uuid NOT NULL,
 "processo_id" uuid NOT NULL,
 "numero" text NOT NULL,
 "emitido_em" date,
 "valor" numeric(15,2) DEFAULT 0 NOT NULL,
 "saldo" numeric(15,2),
 "entrega_prevista" date,
 "entregue_em" date,
 "recebido_em" date,
 "pago_em" date,
 "status" text DEFAULT 'emitido'::text NOT NULL,
 "observacoes" text,
 "criado_em" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."operacao_empenhos" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_empresas" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "organizacao_id" uuid NOT NULL,
 "razao_social" text NOT NULL,
 "cnpj" text,
 "responsavel" text,
 "ativo" boolean DEFAULT true NOT NULL,
 "criado_em" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."operacao_empresas" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_itens_resultado" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "organizacao_id" uuid NOT NULL,
 "processo_id" uuid NOT NULL,
 "identificador" text NOT NULL,
 "tipo" text DEFAULT 'item'::text NOT NULL,
 "descricao" text,
 "situacao" text DEFAULT 'pendente'::text NOT NULL,
 "quantidade" numeric(15,3),
 "valor_proposta" numeric(15,2),
 "valor_homologado" numeric(15,2),
 "motivo" text,
 "fonte_oficial" text,
 "atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
 "marca" text,
 "modelo" text,
 "valor_unitario_proposta" numeric(15,2),
 "valor_unitario_homologado" numeric(15,2)
);

ALTER TABLE public."operacao_itens_resultado" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_limites_cnpj" (
 "usuario_id" uuid NOT NULL,
 "limite" integer NOT NULL,
 "atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."operacao_limites_cnpj" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_membros" (
 "organizacao_id" uuid NOT NULL,
 "usuario_id" uuid NOT NULL,
 "papel" text DEFAULT 'gestor'::text NOT NULL,
 "criado_em" timestamp with time zone DEFAULT now() NOT NULL,
 "empresa_id" uuid
);

ALTER TABLE public."operacao_membros" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_ocorrencias" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "organizacao_id" uuid NOT NULL,
 "processo_id" uuid NOT NULL,
 "ocorrido_em" timestamp with time zone NOT NULL,
 "categoria" text DEFAULT 'registro'::text NOT NULL,
 "descricao" text NOT NULL,
 "fonte_oficial" text,
 "criado_em" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."operacao_ocorrencias" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_organizacoes" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "nome" text NOT NULL,
 "owner_id" uuid NOT NULL,
 "criado_em" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."operacao_organizacoes" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_prazos_processo" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "organizacao_id" uuid NOT NULL,
 "processo_id" uuid NOT NULL,
 "categoria" text NOT NULL,
 "titulo" text NOT NULL,
 "vencimento" timestamp with time zone NOT NULL,
 "responsavel" text,
 "concluido_em" timestamp with time zone,
 "observacoes" text,
 "criado_em" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."operacao_prazos_processo" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_processos" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "organizacao_id" uuid NOT NULL,
 "empresa_id" uuid NOT NULL,
 "numero" text,
 "objeto" text NOT NULL,
 "orgao" text,
 "modalidade" text,
 "url_origem" text,
 "status" text DEFAULT 'triagem'::text NOT NULL,
 "decisao" text DEFAULT 'em_analise'::text NOT NULL,
 "responsavel" text,
 "valor_estimado" numeric(15,2),
 "custo_direto" numeric(15,2),
 "frete" numeric(15,2),
 "tributos_percentual" numeric(7,3),
 "garantia_percentual" numeric(7,3),
 "margem_percentual" numeric(7,3),
 "preco_minimo" numeric(15,2),
 "preco_proposta" numeric(15,2),
 "documentos_exigidos" text[] DEFAULT '{}'::text[] NOT NULL,
 "data_publicacao" date,
 "data_sessao" timestamp with time zone,
 "data_resultado" date,
 "resultado" text,
 "motivo_perda" text,
 "observacoes" text,
 "criado_por" uuid,
 "criado_em" timestamp with time zone DEFAULT now() NOT NULL,
 "atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
 "origem_externa_id" text,
 "sistema" text,
 "uasg" text,
 "situacao_resultado" text DEFAULT 'nao_apurado'::text NOT NULL,
 "valor_homologado" numeric(15,2),
 "fonte_resultado" text,
 "checklist_fonte" text DEFAULT 'manual'::text NOT NULL,
 "checklist_editado_manualmente" boolean DEFAULT false NOT NULL,
 "checklist_gerado_em" timestamp with time zone
);

ALTER TABLE public."operacao_processos" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_renovacoes_documento" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "documento_id" uuid NOT NULL,
 "emissao_anterior" date,
 "vencimento_anterior" date,
 "emissao_nova" date,
 "vencimento_novo" date,
 "registrado_por" uuid,
 "registrado_em" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."operacao_renovacoes_documento" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."operacao_tipos_documento" (
 "id" uuid DEFAULT gen_random_uuid() NOT NULL,
 "organizacao_id" uuid,
 "nome" text NOT NULL,
 "personalizado" boolean DEFAULT false NOT NULL
);

ALTER TABLE public."operacao_tipos_documento" ENABLE ROW LEVEL SECURITY;

CREATE TABLE public."dados_robo" (
 "chave" text NOT NULL,
 "dado" jsonb NOT NULL,
 "atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public."dados_robo" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."admins" ADD CONSTRAINT "admins_pkey" PRIMARY KEY (email);

ALTER TABLE public."clientes" ADD CONSTRAINT "clientes_pkey" PRIMARY KEY (id);

ALTER TABLE public."operacao_agenda" ADD CONSTRAINT "operacao_agenda_pkey" PRIMARY KEY (id);

ALTER TABLE public."operacao_anexos_processo" ADD CONSTRAINT "operacao_anexos_processo_pkey" PRIMARY KEY (id);

ALTER TABLE public."operacao_contratos" ADD CONSTRAINT "operacao_contratos_pkey" PRIMARY KEY (id);

ALTER TABLE public."operacao_convites_empresa" ADD CONSTRAINT "operacao_convites_empresa_pkey" PRIMARY KEY (id);

ALTER TABLE public."operacao_documentos" ADD CONSTRAINT "operacao_documentos_pkey" PRIMARY KEY (id);

ALTER TABLE public."operacao_empenhos" ADD CONSTRAINT "operacao_empenhos_pkey" PRIMARY KEY (id);

ALTER TABLE public."operacao_empresas" ADD CONSTRAINT "operacao_empresas_pkey" PRIMARY KEY (id);

ALTER TABLE public."operacao_itens_resultado" ADD CONSTRAINT "operacao_itens_resultado_pkey" PRIMARY KEY (id);

ALTER TABLE public."operacao_limites_cnpj" ADD CONSTRAINT "operacao_limites_cnpj_pkey" PRIMARY KEY (usuario_id);

ALTER TABLE public."operacao_membros" ADD CONSTRAINT "operacao_membros_pkey" PRIMARY KEY (organizacao_id, usuario_id);

ALTER TABLE public."operacao_ocorrencias" ADD CONSTRAINT "operacao_ocorrencias_pkey" PRIMARY KEY (id);

ALTER TABLE public."operacao_organizacoes" ADD CONSTRAINT "operacao_organizacoes_pkey" PRIMARY KEY (id);

ALTER TABLE public."operacao_prazos_processo" ADD CONSTRAINT "operacao_prazos_processo_pkey" PRIMARY KEY (id);

ALTER TABLE public."operacao_processos" ADD CONSTRAINT "operacao_processos_pkey" PRIMARY KEY (id);

ALTER TABLE public."operacao_renovacoes_documento" ADD CONSTRAINT "operacao_renovacoes_documento_pkey" PRIMARY KEY (id);

ALTER TABLE public."operacao_tipos_documento" ADD CONSTRAINT "operacao_tipos_documento_pkey" PRIMARY KEY (id);

ALTER TABLE public."dados_robo" ADD CONSTRAINT "dados_robo_pkey" PRIMARY KEY (chave);

ALTER TABLE public."operacao_contratos" ADD CONSTRAINT "operacao_contratos_processo_id_numero_key" UNIQUE (processo_id, numero);

ALTER TABLE public."operacao_convites_empresa" ADD CONSTRAINT "operacao_convites_empresa_token_key" UNIQUE (token);

ALTER TABLE public."operacao_empenhos" ADD CONSTRAINT "operacao_empenhos_processo_id_numero_key" UNIQUE (processo_id, numero);

ALTER TABLE public."operacao_empresas" ADD CONSTRAINT "operacao_empresas_organizacao_id_cnpj_key" UNIQUE (organizacao_id, cnpj);

ALTER TABLE public."operacao_itens_resultado" ADD CONSTRAINT "operacao_itens_resultado_processo_id_tipo_identificador_key" UNIQUE (processo_id, tipo, identificador);

ALTER TABLE public."operacao_organizacoes" ADD CONSTRAINT "operacao_organizacoes_owner_id_key" UNIQUE (owner_id);

ALTER TABLE public."operacao_tipos_documento" ADD CONSTRAINT "operacao_tipos_documento_organizacao_id_nome_key" UNIQUE (organizacao_id, nome);

ALTER TABLE public."admins" ADD CONSTRAINT "admins_role_check" CHECK (role = ANY (ARRAY['owner'::text, 'membro'::text]));

ALTER TABLE public."clientes" ADD CONSTRAINT "clientes_boletim_filtro_valido" CHECK (boletim_filtro IS NULL OR jsonb_typeof(boletim_filtro) = 'object'::text AND jsonb_typeof(boletim_filtro -> 'ufs'::text) = 'array'::text AND jsonb_typeof(boletim_filtro -> 'palavrasRaw'::text) = 'string'::text AND jsonb_array_length(boletim_filtro -> 'ufs'::text) <= 27 AND length(btrim(boletim_filtro ->> 'palavrasRaw'::text)) >= 1 AND length(btrim(boletim_filtro ->> 'palavrasRaw'::text)) <= 1000 AND octet_length(boletim_filtro::text) <= 4000 AND boletim_filtro ?& ARRAY['ufs'::text, 'palavrasRaw'::text]);

ALTER TABLE public."clientes" ADD CONSTRAINT "clientes_status_check" CHECK (status = ANY (ARRAY['pendente'::text, 'aprovado'::text, 'rejeitado'::text]));

ALTER TABLE public."operacao_agenda" ADD CONSTRAINT "operacao_agenda_categoria_check" CHECK (categoria = ANY (ARRAY['sessao'::text, 'esclarecimento'::text, 'impugnacao'::text, 'proposta'::text, 'diligencia'::text, 'recurso'::text, 'entrega'::text, 'vigencia'::text, 'reajuste'::text, 'repactuacao'::text, 'renovacao'::text, 'outro'::text]));

ALTER TABLE public."operacao_anexos_processo" ADD CONSTRAINT "operacao_anexos_processo_tipo_check" CHECK (tipo = ANY (ARRAY['edital'::text, 'proposta'::text, 'habilitacao'::text, 'homologacao'::text, 'contrato'::text, 'empenho'::text, 'ata'::text, 'outro'::text]));

ALTER TABLE public."operacao_contratos" ADD CONSTRAINT "operacao_contratos_situacao_check" CHECK (situacao = ANY (ARRAY['a_assinar'::text, 'vigente'::text, 'encerrado'::text, 'rescindido'::text]));

ALTER TABLE public."operacao_contratos" ADD CONSTRAINT "operacao_contratos_valor_check" CHECK (valor IS NULL OR valor >= 0::numeric);

ALTER TABLE public."operacao_empenhos" ADD CONSTRAINT "operacao_empenhos_saldo_check" CHECK (saldo IS NULL OR saldo >= 0::numeric);

ALTER TABLE public."operacao_empenhos" ADD CONSTRAINT "operacao_empenhos_status_check" CHECK (status = ANY (ARRAY['emitido'::text, 'em_execucao'::text, 'entregue'::text, 'recebido'::text, 'pago'::text, 'cancelado'::text]));

ALTER TABLE public."operacao_empenhos" ADD CONSTRAINT "operacao_empenhos_valor_check" CHECK (valor >= 0::numeric);

ALTER TABLE public."operacao_itens_resultado" ADD CONSTRAINT "operacao_itens_resultado_check" CHECK (valor_homologado IS NULL OR valor_homologado >= 0::numeric AND situacao = 'ganho'::text);

ALTER TABLE public."operacao_itens_resultado" ADD CONSTRAINT "operacao_itens_resultado_check1" CHECK (valor_unitario_homologado IS NULL OR valor_unitario_homologado >= 0::numeric AND situacao = 'ganho'::text);

ALTER TABLE public."operacao_itens_resultado" ADD CONSTRAINT "operacao_itens_resultado_quantidade_check" CHECK (quantidade IS NULL OR quantidade >= 0::numeric);

ALTER TABLE public."operacao_itens_resultado" ADD CONSTRAINT "operacao_itens_resultado_situacao_check" CHECK (situacao = ANY (ARRAY['pendente'::text, 'ganho'::text, 'perdido'::text, 'desclassificado'::text, 'inabilitado'::text, 'nao_disputado'::text, 'cancelado'::text]));

ALTER TABLE public."operacao_itens_resultado" ADD CONSTRAINT "operacao_itens_resultado_tipo_check" CHECK (tipo = ANY (ARRAY['item'::text, 'lote'::text]));

ALTER TABLE public."operacao_itens_resultado" ADD CONSTRAINT "operacao_itens_resultado_valor_proposta_check" CHECK (valor_proposta IS NULL OR valor_proposta >= 0::numeric);

ALTER TABLE public."operacao_itens_resultado" ADD CONSTRAINT "operacao_itens_resultado_valor_unitario_proposta_check" CHECK (valor_unitario_proposta IS NULL OR valor_unitario_proposta >= 0::numeric);

ALTER TABLE public."operacao_limites_cnpj" ADD CONSTRAINT "operacao_limites_cnpj_limite_check" CHECK (limite >= 1 AND limite <= 3);

ALTER TABLE public."operacao_membros" ADD CONSTRAINT "operacao_membros_papel_check" CHECK (papel = ANY (ARRAY['gestor'::text, 'operador'::text, 'leitura'::text]));

ALTER TABLE public."operacao_ocorrencias" ADD CONSTRAINT "operacao_ocorrencias_categoria_check" CHECK (categoria = ANY (ARRAY['registro'::text, 'sessao'::text, 'chat'::text, 'diligencia'::text, 'recurso'::text, 'resultado'::text, 'contrato'::text, 'execucao'::text]));

ALTER TABLE public."operacao_prazos_processo" ADD CONSTRAINT "operacao_prazos_processo_categoria_check" CHECK (categoria = ANY (ARRAY['esclarecimento'::text, 'impugnacao'::text, 'proposta'::text, 'sessao'::text, 'diligencia'::text, 'recurso'::text, 'assinatura'::text, 'entrega'::text, 'outro'::text]));

ALTER TABLE public."operacao_processos" ADD CONSTRAINT "operacao_processos_decisao_check" CHECK (decisao = ANY (ARRAY['em_analise'::text, 'participar'::text, 'nao_participar'::text]));

ALTER TABLE public."operacao_processos" ADD CONSTRAINT "operacao_processos_resultado_valido" CHECK (situacao_resultado = ANY (ARRAY['nao_apurado'::text, 'nao_participou'::text, 'em_disputa'::text, 'sem_vitoria'::text, 'vitoria_sem_detalhamento'::text, 'vitoria_parcial'::text, 'vitoria_total'::text, 'revogado_anulado'::text]));

ALTER TABLE public."operacao_processos" ADD CONSTRAINT "operacao_processos_status_check" CHECK (status = ANY (ARRAY['triagem'::text, 'preparacao'::text, 'proposta_enviada'::text, 'sessao'::text, 'habilitacao'::text, 'recurso'::text, 'homologado'::text, 'contratado'::text, 'perdido'::text, 'arquivado'::text]));

ALTER TABLE public."operacao_processos" ADD CONSTRAINT "operacao_processos_valor_homologado_valido" CHECK (valor_homologado IS NULL OR valor_homologado >= 0::numeric);

CREATE INDEX operacao_agenda_organizacao_vencimento_idx ON public.operacao_agenda USING btree (organizacao_id, vencimento);

CREATE INDEX operacao_anexos_processo_idx ON public.operacao_anexos_processo USING btree (processo_id, criado_em DESC);

CREATE INDEX operacao_contratos_processo_idx ON public.operacao_contratos USING btree (processo_id);

CREATE INDEX operacao_documentos_empresa_vencimento_idx ON public.operacao_documentos USING btree (empresa_id, vencimento);

CREATE INDEX operacao_empenhos_processo_status_idx ON public.operacao_empenhos USING btree (processo_id, status);

CREATE UNIQUE INDEX operacao_empresas_id_org_idx ON public.operacao_empresas USING btree (id, organizacao_id);

CREATE INDEX operacao_itens_resultado_processo_idx ON public.operacao_itens_resultado USING btree (processo_id, identificador);

CREATE INDEX operacao_ocorrencias_processo_data_idx ON public.operacao_ocorrencias USING btree (processo_id, ocorrido_em DESC);

CREATE INDEX operacao_prazos_processo_vencimento_idx ON public.operacao_prazos_processo USING btree (processo_id, vencimento);

CREATE INDEX operacao_processos_empresa_status_idx ON public.operacao_processos USING btree (empresa_id, status);

CREATE UNIQUE INDEX operacao_processos_id_org_idx ON public.operacao_processos USING btree (id, organizacao_id);

CREATE INDEX operacao_processos_organizacao_sessao_idx ON public.operacao_processos USING btree (organizacao_id, data_sessao);

CREATE UNIQUE INDEX operacao_processos_origem_externa_unica_idx ON public.operacao_processos USING btree (organizacao_id, empresa_id, origem_externa_id) WHERE (origem_externa_id IS NOT NULL);

ALTER TABLE public."clientes" ADD CONSTRAINT "clientes_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_agenda" ADD CONSTRAINT "operacao_agenda_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES operacao_empresas(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_agenda" ADD CONSTRAINT "operacao_agenda_organizacao_id_fkey" FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_anexos_processo" ADD CONSTRAINT "operacao_anexos_processo_processo_id_organizacao_id_fkey" FOREIGN KEY (processo_id, organizacao_id) REFERENCES operacao_processos(id, organizacao_id) ON DELETE CASCADE;

ALTER TABLE public."operacao_contratos" ADD CONSTRAINT "operacao_contratos_processo_id_organizacao_id_fkey" FOREIGN KEY (processo_id, organizacao_id) REFERENCES operacao_processos(id, organizacao_id) ON DELETE CASCADE;

ALTER TABLE public."operacao_convites_empresa" ADD CONSTRAINT "operacao_convites_empresa_criado_por_fkey" FOREIGN KEY (criado_por) REFERENCES auth.users(id);

ALTER TABLE public."operacao_convites_empresa" ADD CONSTRAINT "operacao_convites_empresa_empresa_id_organizacao_id_fkey" FOREIGN KEY (empresa_id, organizacao_id) REFERENCES operacao_empresas(id, organizacao_id) ON DELETE CASCADE;

ALTER TABLE public."operacao_convites_empresa" ADD CONSTRAINT "operacao_convites_empresa_organizacao_id_fkey" FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_documentos" ADD CONSTRAINT "operacao_documentos_criado_por_fkey" FOREIGN KEY (criado_por) REFERENCES auth.users(id);

ALTER TABLE public."operacao_documentos" ADD CONSTRAINT "operacao_documentos_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES operacao_empresas(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_documentos" ADD CONSTRAINT "operacao_documentos_organizacao_id_fkey" FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_empenhos" ADD CONSTRAINT "operacao_empenhos_organizacao_id_fkey" FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_empenhos" ADD CONSTRAINT "operacao_empenhos_processo_id_fkey" FOREIGN KEY (processo_id) REFERENCES operacao_processos(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_empresas" ADD CONSTRAINT "operacao_empresas_organizacao_id_fkey" FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_itens_resultado" ADD CONSTRAINT "operacao_itens_resultado_processo_id_organizacao_id_fkey" FOREIGN KEY (processo_id, organizacao_id) REFERENCES operacao_processos(id, organizacao_id) ON DELETE CASCADE;

ALTER TABLE public."operacao_limites_cnpj" ADD CONSTRAINT "operacao_limites_cnpj_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_membros" ADD CONSTRAINT "operacao_membros_empresa_org_fk" FOREIGN KEY (empresa_id, organizacao_id) REFERENCES operacao_empresas(id, organizacao_id) ON DELETE CASCADE;

ALTER TABLE public."operacao_membros" ADD CONSTRAINT "operacao_membros_organizacao_id_fkey" FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_membros" ADD CONSTRAINT "operacao_membros_usuario_id_fkey" FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_ocorrencias" ADD CONSTRAINT "operacao_ocorrencias_processo_id_organizacao_id_fkey" FOREIGN KEY (processo_id, organizacao_id) REFERENCES operacao_processos(id, organizacao_id) ON DELETE CASCADE;

ALTER TABLE public."operacao_organizacoes" ADD CONSTRAINT "operacao_organizacoes_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_prazos_processo" ADD CONSTRAINT "operacao_prazos_processo_organizacao_id_fkey" FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_prazos_processo" ADD CONSTRAINT "operacao_prazos_processo_processo_id_fkey" FOREIGN KEY (processo_id) REFERENCES operacao_processos(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_processos" ADD CONSTRAINT "operacao_processos_criado_por_fkey" FOREIGN KEY (criado_por) REFERENCES auth.users(id);

ALTER TABLE public."operacao_processos" ADD CONSTRAINT "operacao_processos_empresa_id_fkey" FOREIGN KEY (empresa_id) REFERENCES operacao_empresas(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_processos" ADD CONSTRAINT "operacao_processos_organizacao_id_fkey" FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_renovacoes_documento" ADD CONSTRAINT "operacao_renovacoes_documento_documento_id_fkey" FOREIGN KEY (documento_id) REFERENCES operacao_documentos(id) ON DELETE CASCADE;

ALTER TABLE public."operacao_renovacoes_documento" ADD CONSTRAINT "operacao_renovacoes_documento_registrado_por_fkey" FOREIGN KEY (registrado_por) REFERENCES auth.users(id);

ALTER TABLE public."operacao_tipos_documento" ADD CONSTRAINT "operacao_tipos_documento_organizacao_id_fkey" FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE;

CREATE FUNCTION public.admin_tem_permissao(permissao text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.admins a
    where a.email = (auth.jwt() ->> 'email')
      and (a.role = 'owner' or a.permissoes ? 'all' or a.permissoes ? permissao)
  );
$function$;

CREATE FUNCTION public.eh_membro_operacao(p_organizacao_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from public.operacao_membros m where m.organizacao_id = p_organizacao_id and m.usuario_id = auth.uid() and m.empresa_id is null); $function$;

CREATE FUNCTION public.tem_vinculo_operacao(p_organizacao_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from public.operacao_membros m where m.organizacao_id = p_organizacao_id and m.usuario_id = auth.uid()); $function$;

CREATE FUNCTION public.pode_acessar_empresa_operacao(p_org uuid, p_empresa uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from public.operacao_empresas e join public.operacao_membros m on m.organizacao_id = e.organizacao_id where e.id = p_empresa and e.organizacao_id = p_org and m.usuario_id = auth.uid() and (m.empresa_id is null or m.empresa_id = e.id)); $function$;

CREATE FUNCTION public.pode_acessar_processo_operacao(p_org uuid, p_processo uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from public.operacao_processos p where p.id = p_processo and p.organizacao_id = p_org and public.pode_acessar_empresa_operacao(p.organizacao_id, p.empresa_id)); $function$;

CREATE FUNCTION public.acesso_arquivo_operacao(p_caminho text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare partes text[] := string_to_array(p_caminho, '/'); begin if array_length(partes, 1) < 3 then return false; end if; return public.pode_acessar_empresa_operacao(partes[1]::uuid, partes[2]::uuid); exception when invalid_text_representation then return false; end; $function$;

CREATE FUNCTION public.eh_owner_admin_operacao(p_usuario_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
        select exists (
            select 1 from auth.users u join public.admins a on lower(a.email) = lower(u.email)
                where u.id = p_usuario_id and a.role = 'owner'
                  );
                  $function$;

CREATE FUNCTION public.limite_cnpjs_operacao()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                  declare v_usuario uuid := auth.uid(); v_limite integer;
                  begin
                    if v_usuario is null then raise exception 'Sessão inválida'; end if;
                      if public.eh_owner_admin_operacao(v_usuario) then return null; end if;
                        select limite into v_limite from public.operacao_limites_cnpj where usuario_id = v_usuario;
                          return coalesce(v_limite, 3);
                          end;
                          $function$;

CREATE FUNCTION public.aceitar_convite_empresa_operacao(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_convite public.operacao_convites_empresa; v_usuario uuid := auth.uid(); v_email text; v_empresa public.operacao_empresas; begin if v_usuario is null then raise exception 'Faça login para aceitar o convite'; end if; select * into v_convite from public.operacao_convites_empresa where token = p_token for update; if not found or v_convite.revogado_em is not null or v_convite.expira_em <= now() or v_convite.aceito_em is not null then raise exception 'Convite inválido ou expirado'; end if; select lower(email) into v_email from auth.users where id = v_usuario; if v_email is distinct from v_convite.email then raise exception 'Entre com o e-mail indicado no convite'; end if; if exists (select 1 from public.operacao_organizacoes where owner_id = v_usuario) or exists (select 1 from public.operacao_membros where usuario_id = v_usuario) then raise exception 'Esta conta já gerencia uma operação. Use um e-mail próprio para este acesso restrito'; end if; select * into v_empresa from public.operacao_empresas where id = v_convite.empresa_id and ativo = true; if not found then raise exception 'Empresa indisponível'; end if; insert into public.operacao_membros (organizacao_id, usuario_id, papel, empresa_id) values (v_convite.organizacao_id, v_usuario, 'operador', v_convite.empresa_id); update public.clientes set status = 'aprovado', nome = v_convite.nome, empresa = v_empresa.razao_social, cnpj = v_empresa.cnpj where id = v_usuario; if not found then raise exception 'Cadastro do usuário ainda não está disponível'; end if; update public.operacao_convites_empresa set aceito_em = now() where id = v_convite.id; return jsonb_build_object('empresa', v_empresa.razao_social, 'empresa_id', v_empresa.id); end; $function$;

CREATE FUNCTION public.bootstrap_operacao()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_usuario uuid := auth.uid(); v_org uuid; v_nome text; v_cnpj text; begin if v_usuario is null then raise exception 'Sessão inválida'; end if; if not exists (select 1 from public.clientes c where c.id = v_usuario and c.status = 'aprovado') then raise exception 'Cadastro sem acesso ativo'; end if; select id into v_org from public.operacao_organizacoes where owner_id = v_usuario; if v_org is not null then return v_org; end if; select organizacao_id into v_org from public.operacao_membros where usuario_id = v_usuario order by criado_em limit 1; if v_org is not null then return v_org; end if; if exists (select 1 from public.operacao_convites_empresa i join auth.users u on lower(u.email) = i.email where u.id = v_usuario and i.aceito_em is null and i.revogado_em is null and i.expira_em > now()) then raise exception 'Aceite o convite recebido antes de abrir a Central Operacional'; end if; select coalesce(nullif(empresa, ''), nullif(nome, ''), 'Minha operação'), cnpj into v_nome, v_cnpj from public.clientes where id = v_usuario; insert into public.operacao_organizacoes (nome, owner_id) values (coalesce(v_nome, 'Minha operação'), v_usuario) returning id into v_org; insert into public.operacao_membros (organizacao_id, usuario_id, papel) values (v_org, v_usuario, 'gestor'); insert into public.operacao_empresas (organizacao_id, razao_social, cnpj) values (v_org, coalesce(v_nome, 'Minha empresa'), nullif(v_cnpj, '')); return v_org; end; $function$;

CREATE FUNCTION public.configurar_limite_cnpjs_cliente(p_usuario_id uuid, p_limite integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                                                                                    $function$;

CREATE FUNCTION public.consultar_limite_cnpjs_cliente(p_usuario_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                          declare v_limite integer;
                          begin
                            if not public.eh_owner_admin_operacao(auth.uid()) then
                                raise exception 'Apenas o proprietário administrativo pode configurar cotas';
                                  end if;
                                    if public.eh_owner_admin_operacao(p_usuario_id) then return null; end if;
                                      select limite into v_limite from public.operacao_limites_cnpj where usuario_id = p_usuario_id;
                                        return coalesce(v_limite, 3);
                                        end;
                                        $function$;

CREATE FUNCTION public.criar_convite_empresa_operacao(p_empresa_id uuid, p_email text, p_nome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_convite public.operacao_convites_empresa; v_org uuid; begin if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if; if p_email is null or p_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'E-mail inválido'; end if; if length(trim(coalesce(p_nome,''))) < 2 then raise exception 'Informe o nome da pessoa'; end if; select e.organizacao_id into v_org from public.operacao_empresas e where e.id = p_empresa_id and e.ativo = true; if v_org is null then raise exception 'Empresa não encontrada'; end if; insert into public.operacao_convites_empresa (organizacao_id, empresa_id, email, nome, criado_por) values (v_org, p_empresa_id, lower(trim(p_email)), trim(p_nome), auth.uid()) returning * into v_convite; return jsonb_build_object('id', v_convite.id, 'token', v_convite.token, 'expira_em', v_convite.expira_em); end; $function$;

CREATE FUNCTION public.listar_acessos_empresa_operacao()
 RETURNS TABLE(usuario_id uuid, email text, nome text, empresa text, empresa_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if; return query select m.usuario_id, u.email::text, c.nome, e.razao_social, e.id from public.operacao_membros m join public.operacao_empresas e on e.id = m.empresa_id join auth.users u on u.id = m.usuario_id left join public.clientes c on c.id = m.usuario_id where m.empresa_id is not null order by e.razao_social, u.email; end; $function$;

CREATE FUNCTION public.listar_convites_empresa_operacao()
 RETURNS TABLE(id uuid, email text, nome text, empresa text, expira_em timestamp with time zone, aceito_em timestamp with time zone, revogado_em timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if; return query select c.id, c.email, c.nome, e.razao_social, c.expira_em, c.aceito_em, c.revogado_em from public.operacao_convites_empresa c join public.operacao_empresas e on e.id = c.empresa_id order by c.criado_em desc limit 100; end; $function$;

CREATE FUNCTION public.listar_empresas_convite_operacao()
 RETURNS TABLE(id uuid, razao_social text, cnpj text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if; return query select e.id, e.razao_social, e.cnpj from public.operacao_empresas e where e.ativo = true order by e.razao_social; end; $function$;

CREATE FUNCTION public.meu_acesso_operacao()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select coalesce((select jsonb_build_object('organizacao_id', m.organizacao_id, 'empresa_id', m.empresa_id, 'papel', m.papel) from public.operacao_membros m where m.usuario_id = auth.uid() order by (m.empresa_id is null) desc, m.criado_em limit 1), '{}'::jsonb); $function$;

CREATE FUNCTION public.proteger_status_cliente_operacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                                    $function$;

CREATE FUNCTION public.revogar_acesso_empresa_operacao(p_usuario_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if; delete from public.operacao_membros where usuario_id = p_usuario_id and empresa_id is not null; if not found then return false; end if; update public.clientes set status = 'rejeitado' where id = p_usuario_id; return true; end; $function$;

CREATE FUNCTION public.revogar_convite_empresa_operacao(p_convite_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ begin if not public.eh_owner_admin_operacao(auth.uid()) then raise exception 'Acesso restrito ao proprietário administrativo'; end if; update public.operacao_convites_empresa set revogado_em = now() where id = p_convite_id and aceito_em is null and revogado_em is null; return found; end; $function$;

CREATE FUNCTION public.verificar_limite_cnpjs_operacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
                                                                                    declare v_owner uuid; v_limite integer; v_total integer;
                                                                                    begin
                                                                                      if not new.ativo then return new; end if;
                                                                                        if tg_op = 'UPDATE' then
                                                                                            if old.ativo and old.organizacao_id = new.organizacao_id then return new; end if;
                                                                                              end if;
                                                                                                select owner_id into v_owner from public.operacao_organizacoes
                                                                                                    where id = new.organizacao_id for update;
                                                                                                      if v_owner is null then raise exception 'Organização não encontrada'; end if;
                                                                                                        if public.eh_owner_admin_operacao(v_owner) then return new; end if;
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
                                                                                                                                    $function$;

CREATE FUNCTION public.criar_cliente_no_cadastro()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

REVOKE ALL ON TABLE public."admins" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."admins" TO "anon";

GRANT INSERT ON TABLE public."admins" TO "anon";

GRANT MAINTAIN ON TABLE public."admins" TO "anon";

GRANT REFERENCES ON TABLE public."admins" TO "anon";

GRANT SELECT ON TABLE public."admins" TO "anon";

GRANT TRIGGER ON TABLE public."admins" TO "anon";

GRANT TRUNCATE ON TABLE public."admins" TO "anon";

GRANT UPDATE ON TABLE public."admins" TO "anon";

GRANT DELETE ON TABLE public."admins" TO "authenticated";

GRANT INSERT ON TABLE public."admins" TO "authenticated";

GRANT MAINTAIN ON TABLE public."admins" TO "authenticated";

GRANT REFERENCES ON TABLE public."admins" TO "authenticated";

GRANT SELECT ON TABLE public."admins" TO "authenticated";

GRANT TRIGGER ON TABLE public."admins" TO "authenticated";

GRANT TRUNCATE ON TABLE public."admins" TO "authenticated";

GRANT UPDATE ON TABLE public."admins" TO "authenticated";

GRANT DELETE ON TABLE public."admins" TO "service_role";

GRANT INSERT ON TABLE public."admins" TO "service_role";

GRANT MAINTAIN ON TABLE public."admins" TO "service_role";

GRANT REFERENCES ON TABLE public."admins" TO "service_role";

GRANT SELECT ON TABLE public."admins" TO "service_role";

GRANT TRIGGER ON TABLE public."admins" TO "service_role";

GRANT TRUNCATE ON TABLE public."admins" TO "service_role";

GRANT UPDATE ON TABLE public."admins" TO "service_role";

REVOKE ALL ON TABLE public."clientes" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."clientes" TO "anon";

GRANT INSERT ON TABLE public."clientes" TO "anon";

GRANT MAINTAIN ON TABLE public."clientes" TO "anon";

GRANT REFERENCES ON TABLE public."clientes" TO "anon";

GRANT SELECT ON TABLE public."clientes" TO "anon";

GRANT TRIGGER ON TABLE public."clientes" TO "anon";

GRANT TRUNCATE ON TABLE public."clientes" TO "anon";

GRANT UPDATE ON TABLE public."clientes" TO "anon";

GRANT DELETE ON TABLE public."clientes" TO "authenticated";

GRANT INSERT ON TABLE public."clientes" TO "authenticated";

GRANT MAINTAIN ON TABLE public."clientes" TO "authenticated";

GRANT REFERENCES ON TABLE public."clientes" TO "authenticated";

GRANT SELECT ON TABLE public."clientes" TO "authenticated";

GRANT TRIGGER ON TABLE public."clientes" TO "authenticated";

GRANT TRUNCATE ON TABLE public."clientes" TO "authenticated";

GRANT UPDATE ON TABLE public."clientes" TO "authenticated";

GRANT DELETE ON TABLE public."clientes" TO "service_role";

GRANT INSERT ON TABLE public."clientes" TO "service_role";

GRANT MAINTAIN ON TABLE public."clientes" TO "service_role";

GRANT REFERENCES ON TABLE public."clientes" TO "service_role";

GRANT SELECT ON TABLE public."clientes" TO "service_role";

GRANT TRIGGER ON TABLE public."clientes" TO "service_role";

GRANT TRUNCATE ON TABLE public."clientes" TO "service_role";

GRANT UPDATE ON TABLE public."clientes" TO "service_role";

REVOKE ALL ON TABLE public."operacao_agenda" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_agenda" TO "anon";

GRANT INSERT ON TABLE public."operacao_agenda" TO "anon";

GRANT MAINTAIN ON TABLE public."operacao_agenda" TO "anon";

GRANT REFERENCES ON TABLE public."operacao_agenda" TO "anon";

GRANT SELECT ON TABLE public."operacao_agenda" TO "anon";

GRANT TRIGGER ON TABLE public."operacao_agenda" TO "anon";

GRANT TRUNCATE ON TABLE public."operacao_agenda" TO "anon";

GRANT UPDATE ON TABLE public."operacao_agenda" TO "anon";

GRANT DELETE ON TABLE public."operacao_agenda" TO "authenticated";

GRANT INSERT ON TABLE public."operacao_agenda" TO "authenticated";

GRANT MAINTAIN ON TABLE public."operacao_agenda" TO "authenticated";

GRANT REFERENCES ON TABLE public."operacao_agenda" TO "authenticated";

GRANT SELECT ON TABLE public."operacao_agenda" TO "authenticated";

GRANT TRIGGER ON TABLE public."operacao_agenda" TO "authenticated";

GRANT TRUNCATE ON TABLE public."operacao_agenda" TO "authenticated";

GRANT UPDATE ON TABLE public."operacao_agenda" TO "authenticated";

GRANT DELETE ON TABLE public."operacao_agenda" TO "service_role";

GRANT INSERT ON TABLE public."operacao_agenda" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_agenda" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_agenda" TO "service_role";

GRANT SELECT ON TABLE public."operacao_agenda" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_agenda" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_agenda" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_agenda" TO "service_role";

REVOKE ALL ON TABLE public."operacao_anexos_processo" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_anexos_processo" TO "anon";

GRANT INSERT ON TABLE public."operacao_anexos_processo" TO "anon";

GRANT MAINTAIN ON TABLE public."operacao_anexos_processo" TO "anon";

GRANT REFERENCES ON TABLE public."operacao_anexos_processo" TO "anon";

GRANT SELECT ON TABLE public."operacao_anexos_processo" TO "anon";

GRANT TRIGGER ON TABLE public."operacao_anexos_processo" TO "anon";

GRANT TRUNCATE ON TABLE public."operacao_anexos_processo" TO "anon";

GRANT UPDATE ON TABLE public."operacao_anexos_processo" TO "anon";

GRANT DELETE ON TABLE public."operacao_anexos_processo" TO "authenticated";

GRANT INSERT ON TABLE public."operacao_anexos_processo" TO "authenticated";

GRANT MAINTAIN ON TABLE public."operacao_anexos_processo" TO "authenticated";

GRANT REFERENCES ON TABLE public."operacao_anexos_processo" TO "authenticated";

GRANT SELECT ON TABLE public."operacao_anexos_processo" TO "authenticated";

GRANT TRIGGER ON TABLE public."operacao_anexos_processo" TO "authenticated";

GRANT TRUNCATE ON TABLE public."operacao_anexos_processo" TO "authenticated";

GRANT UPDATE ON TABLE public."operacao_anexos_processo" TO "authenticated";

GRANT DELETE ON TABLE public."operacao_anexos_processo" TO "service_role";

GRANT INSERT ON TABLE public."operacao_anexos_processo" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_anexos_processo" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_anexos_processo" TO "service_role";

GRANT SELECT ON TABLE public."operacao_anexos_processo" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_anexos_processo" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_anexos_processo" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_anexos_processo" TO "service_role";

REVOKE ALL ON TABLE public."operacao_contratos" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_contratos" TO "anon";

GRANT INSERT ON TABLE public."operacao_contratos" TO "anon";

GRANT MAINTAIN ON TABLE public."operacao_contratos" TO "anon";

GRANT REFERENCES ON TABLE public."operacao_contratos" TO "anon";

GRANT SELECT ON TABLE public."operacao_contratos" TO "anon";

GRANT TRIGGER ON TABLE public."operacao_contratos" TO "anon";

GRANT TRUNCATE ON TABLE public."operacao_contratos" TO "anon";

GRANT UPDATE ON TABLE public."operacao_contratos" TO "anon";

GRANT DELETE ON TABLE public."operacao_contratos" TO "authenticated";

GRANT INSERT ON TABLE public."operacao_contratos" TO "authenticated";

GRANT MAINTAIN ON TABLE public."operacao_contratos" TO "authenticated";

GRANT REFERENCES ON TABLE public."operacao_contratos" TO "authenticated";

GRANT SELECT ON TABLE public."operacao_contratos" TO "authenticated";

GRANT TRIGGER ON TABLE public."operacao_contratos" TO "authenticated";

GRANT TRUNCATE ON TABLE public."operacao_contratos" TO "authenticated";

GRANT UPDATE ON TABLE public."operacao_contratos" TO "authenticated";

GRANT DELETE ON TABLE public."operacao_contratos" TO "service_role";

GRANT INSERT ON TABLE public."operacao_contratos" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_contratos" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_contratos" TO "service_role";

GRANT SELECT ON TABLE public."operacao_contratos" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_contratos" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_contratos" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_contratos" TO "service_role";

REVOKE ALL ON TABLE public."operacao_convites_empresa" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_convites_empresa" TO "service_role";

GRANT INSERT ON TABLE public."operacao_convites_empresa" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_convites_empresa" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_convites_empresa" TO "service_role";

GRANT SELECT ON TABLE public."operacao_convites_empresa" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_convites_empresa" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_convites_empresa" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_convites_empresa" TO "service_role";

REVOKE ALL ON TABLE public."operacao_documentos" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_documentos" TO "anon";

GRANT INSERT ON TABLE public."operacao_documentos" TO "anon";

GRANT MAINTAIN ON TABLE public."operacao_documentos" TO "anon";

GRANT REFERENCES ON TABLE public."operacao_documentos" TO "anon";

GRANT SELECT ON TABLE public."operacao_documentos" TO "anon";

GRANT TRIGGER ON TABLE public."operacao_documentos" TO "anon";

GRANT TRUNCATE ON TABLE public."operacao_documentos" TO "anon";

GRANT UPDATE ON TABLE public."operacao_documentos" TO "anon";

GRANT DELETE ON TABLE public."operacao_documentos" TO "authenticated";

GRANT INSERT ON TABLE public."operacao_documentos" TO "authenticated";

GRANT MAINTAIN ON TABLE public."operacao_documentos" TO "authenticated";

GRANT REFERENCES ON TABLE public."operacao_documentos" TO "authenticated";

GRANT SELECT ON TABLE public."operacao_documentos" TO "authenticated";

GRANT TRIGGER ON TABLE public."operacao_documentos" TO "authenticated";

GRANT TRUNCATE ON TABLE public."operacao_documentos" TO "authenticated";

GRANT UPDATE ON TABLE public."operacao_documentos" TO "authenticated";

GRANT DELETE ON TABLE public."operacao_documentos" TO "service_role";

GRANT INSERT ON TABLE public."operacao_documentos" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_documentos" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_documentos" TO "service_role";

GRANT SELECT ON TABLE public."operacao_documentos" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_documentos" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_documentos" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_documentos" TO "service_role";

REVOKE ALL ON TABLE public."operacao_empenhos" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_empenhos" TO "anon";

GRANT INSERT ON TABLE public."operacao_empenhos" TO "anon";

GRANT MAINTAIN ON TABLE public."operacao_empenhos" TO "anon";

GRANT REFERENCES ON TABLE public."operacao_empenhos" TO "anon";

GRANT SELECT ON TABLE public."operacao_empenhos" TO "anon";

GRANT TRIGGER ON TABLE public."operacao_empenhos" TO "anon";

GRANT TRUNCATE ON TABLE public."operacao_empenhos" TO "anon";

GRANT UPDATE ON TABLE public."operacao_empenhos" TO "anon";

GRANT DELETE ON TABLE public."operacao_empenhos" TO "authenticated";

GRANT INSERT ON TABLE public."operacao_empenhos" TO "authenticated";

GRANT MAINTAIN ON TABLE public."operacao_empenhos" TO "authenticated";

GRANT REFERENCES ON TABLE public."operacao_empenhos" TO "authenticated";

GRANT SELECT ON TABLE public."operacao_empenhos" TO "authenticated";

GRANT TRIGGER ON TABLE public."operacao_empenhos" TO "authenticated";

GRANT TRUNCATE ON TABLE public."operacao_empenhos" TO "authenticated";

GRANT UPDATE ON TABLE public."operacao_empenhos" TO "authenticated";

GRANT DELETE ON TABLE public."operacao_empenhos" TO "service_role";

GRANT INSERT ON TABLE public."operacao_empenhos" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_empenhos" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_empenhos" TO "service_role";

GRANT SELECT ON TABLE public."operacao_empenhos" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_empenhos" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_empenhos" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_empenhos" TO "service_role";

REVOKE ALL ON TABLE public."operacao_empresas" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_empresas" TO "anon";

GRANT INSERT ON TABLE public."operacao_empresas" TO "anon";

GRANT MAINTAIN ON TABLE public."operacao_empresas" TO "anon";

GRANT REFERENCES ON TABLE public."operacao_empresas" TO "anon";

GRANT SELECT ON TABLE public."operacao_empresas" TO "anon";

GRANT TRIGGER ON TABLE public."operacao_empresas" TO "anon";

GRANT TRUNCATE ON TABLE public."operacao_empresas" TO "anon";

GRANT UPDATE ON TABLE public."operacao_empresas" TO "anon";

GRANT DELETE ON TABLE public."operacao_empresas" TO "authenticated";

GRANT INSERT ON TABLE public."operacao_empresas" TO "authenticated";

GRANT MAINTAIN ON TABLE public."operacao_empresas" TO "authenticated";

GRANT REFERENCES ON TABLE public."operacao_empresas" TO "authenticated";

GRANT SELECT ON TABLE public."operacao_empresas" TO "authenticated";

GRANT TRIGGER ON TABLE public."operacao_empresas" TO "authenticated";

GRANT TRUNCATE ON TABLE public."operacao_empresas" TO "authenticated";

GRANT UPDATE ON TABLE public."operacao_empresas" TO "authenticated";

GRANT DELETE ON TABLE public."operacao_empresas" TO "service_role";

GRANT INSERT ON TABLE public."operacao_empresas" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_empresas" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_empresas" TO "service_role";

GRANT SELECT ON TABLE public."operacao_empresas" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_empresas" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_empresas" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_empresas" TO "service_role";

REVOKE ALL ON TABLE public."operacao_itens_resultado" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_itens_resultado" TO "anon";

GRANT INSERT ON TABLE public."operacao_itens_resultado" TO "anon";

GRANT MAINTAIN ON TABLE public."operacao_itens_resultado" TO "anon";

GRANT REFERENCES ON TABLE public."operacao_itens_resultado" TO "anon";

GRANT SELECT ON TABLE public."operacao_itens_resultado" TO "anon";

GRANT TRIGGER ON TABLE public."operacao_itens_resultado" TO "anon";

GRANT TRUNCATE ON TABLE public."operacao_itens_resultado" TO "anon";

GRANT UPDATE ON TABLE public."operacao_itens_resultado" TO "anon";

GRANT DELETE ON TABLE public."operacao_itens_resultado" TO "authenticated";

GRANT INSERT ON TABLE public."operacao_itens_resultado" TO "authenticated";

GRANT MAINTAIN ON TABLE public."operacao_itens_resultado" TO "authenticated";

GRANT REFERENCES ON TABLE public."operacao_itens_resultado" TO "authenticated";

GRANT SELECT ON TABLE public."operacao_itens_resultado" TO "authenticated";

GRANT TRIGGER ON TABLE public."operacao_itens_resultado" TO "authenticated";

GRANT TRUNCATE ON TABLE public."operacao_itens_resultado" TO "authenticated";

GRANT UPDATE ON TABLE public."operacao_itens_resultado" TO "authenticated";

GRANT DELETE ON TABLE public."operacao_itens_resultado" TO "service_role";

GRANT INSERT ON TABLE public."operacao_itens_resultado" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_itens_resultado" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_itens_resultado" TO "service_role";

GRANT SELECT ON TABLE public."operacao_itens_resultado" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_itens_resultado" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_itens_resultado" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_itens_resultado" TO "service_role";

REVOKE ALL ON TABLE public."operacao_limites_cnpj" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_limites_cnpj" TO "service_role";

GRANT INSERT ON TABLE public."operacao_limites_cnpj" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_limites_cnpj" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_limites_cnpj" TO "service_role";

GRANT SELECT ON TABLE public."operacao_limites_cnpj" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_limites_cnpj" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_limites_cnpj" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_limites_cnpj" TO "service_role";

REVOKE ALL ON TABLE public."operacao_membros" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_membros" TO "anon";

GRANT INSERT ON TABLE public."operacao_membros" TO "anon";

GRANT MAINTAIN ON TABLE public."operacao_membros" TO "anon";

GRANT REFERENCES ON TABLE public."operacao_membros" TO "anon";

GRANT SELECT ON TABLE public."operacao_membros" TO "anon";

GRANT TRIGGER ON TABLE public."operacao_membros" TO "anon";

GRANT TRUNCATE ON TABLE public."operacao_membros" TO "anon";

GRANT UPDATE ON TABLE public."operacao_membros" TO "anon";

GRANT DELETE ON TABLE public."operacao_membros" TO "authenticated";

GRANT INSERT ON TABLE public."operacao_membros" TO "authenticated";

GRANT MAINTAIN ON TABLE public."operacao_membros" TO "authenticated";

GRANT REFERENCES ON TABLE public."operacao_membros" TO "authenticated";

GRANT SELECT ON TABLE public."operacao_membros" TO "authenticated";

GRANT TRIGGER ON TABLE public."operacao_membros" TO "authenticated";

GRANT TRUNCATE ON TABLE public."operacao_membros" TO "authenticated";

GRANT UPDATE ON TABLE public."operacao_membros" TO "authenticated";

GRANT DELETE ON TABLE public."operacao_membros" TO "service_role";

GRANT INSERT ON TABLE public."operacao_membros" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_membros" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_membros" TO "service_role";

GRANT SELECT ON TABLE public."operacao_membros" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_membros" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_membros" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_membros" TO "service_role";

REVOKE ALL ON TABLE public."operacao_ocorrencias" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_ocorrencias" TO "anon";

GRANT INSERT ON TABLE public."operacao_ocorrencias" TO "anon";

GRANT MAINTAIN ON TABLE public."operacao_ocorrencias" TO "anon";

GRANT REFERENCES ON TABLE public."operacao_ocorrencias" TO "anon";

GRANT SELECT ON TABLE public."operacao_ocorrencias" TO "anon";

GRANT TRIGGER ON TABLE public."operacao_ocorrencias" TO "anon";

GRANT TRUNCATE ON TABLE public."operacao_ocorrencias" TO "anon";

GRANT UPDATE ON TABLE public."operacao_ocorrencias" TO "anon";

GRANT DELETE ON TABLE public."operacao_ocorrencias" TO "authenticated";

GRANT INSERT ON TABLE public."operacao_ocorrencias" TO "authenticated";

GRANT MAINTAIN ON TABLE public."operacao_ocorrencias" TO "authenticated";

GRANT REFERENCES ON TABLE public."operacao_ocorrencias" TO "authenticated";

GRANT SELECT ON TABLE public."operacao_ocorrencias" TO "authenticated";

GRANT TRIGGER ON TABLE public."operacao_ocorrencias" TO "authenticated";

GRANT TRUNCATE ON TABLE public."operacao_ocorrencias" TO "authenticated";

GRANT UPDATE ON TABLE public."operacao_ocorrencias" TO "authenticated";

GRANT DELETE ON TABLE public."operacao_ocorrencias" TO "service_role";

GRANT INSERT ON TABLE public."operacao_ocorrencias" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_ocorrencias" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_ocorrencias" TO "service_role";

GRANT SELECT ON TABLE public."operacao_ocorrencias" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_ocorrencias" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_ocorrencias" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_ocorrencias" TO "service_role";

REVOKE ALL ON TABLE public."operacao_organizacoes" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_organizacoes" TO "anon";

GRANT INSERT ON TABLE public."operacao_organizacoes" TO "anon";

GRANT MAINTAIN ON TABLE public."operacao_organizacoes" TO "anon";

GRANT REFERENCES ON TABLE public."operacao_organizacoes" TO "anon";

GRANT SELECT ON TABLE public."operacao_organizacoes" TO "anon";

GRANT TRIGGER ON TABLE public."operacao_organizacoes" TO "anon";

GRANT TRUNCATE ON TABLE public."operacao_organizacoes" TO "anon";

GRANT UPDATE ON TABLE public."operacao_organizacoes" TO "anon";

GRANT DELETE ON TABLE public."operacao_organizacoes" TO "authenticated";

GRANT INSERT ON TABLE public."operacao_organizacoes" TO "authenticated";

GRANT MAINTAIN ON TABLE public."operacao_organizacoes" TO "authenticated";

GRANT REFERENCES ON TABLE public."operacao_organizacoes" TO "authenticated";

GRANT SELECT ON TABLE public."operacao_organizacoes" TO "authenticated";

GRANT TRIGGER ON TABLE public."operacao_organizacoes" TO "authenticated";

GRANT TRUNCATE ON TABLE public."operacao_organizacoes" TO "authenticated";

GRANT UPDATE ON TABLE public."operacao_organizacoes" TO "authenticated";

GRANT DELETE ON TABLE public."operacao_organizacoes" TO "service_role";

GRANT INSERT ON TABLE public."operacao_organizacoes" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_organizacoes" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_organizacoes" TO "service_role";

GRANT SELECT ON TABLE public."operacao_organizacoes" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_organizacoes" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_organizacoes" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_organizacoes" TO "service_role";

REVOKE ALL ON TABLE public."operacao_prazos_processo" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_prazos_processo" TO "anon";

GRANT INSERT ON TABLE public."operacao_prazos_processo" TO "anon";

GRANT MAINTAIN ON TABLE public."operacao_prazos_processo" TO "anon";

GRANT REFERENCES ON TABLE public."operacao_prazos_processo" TO "anon";

GRANT SELECT ON TABLE public."operacao_prazos_processo" TO "anon";

GRANT TRIGGER ON TABLE public."operacao_prazos_processo" TO "anon";

GRANT TRUNCATE ON TABLE public."operacao_prazos_processo" TO "anon";

GRANT UPDATE ON TABLE public."operacao_prazos_processo" TO "anon";

GRANT DELETE ON TABLE public."operacao_prazos_processo" TO "authenticated";

GRANT INSERT ON TABLE public."operacao_prazos_processo" TO "authenticated";

GRANT MAINTAIN ON TABLE public."operacao_prazos_processo" TO "authenticated";

GRANT REFERENCES ON TABLE public."operacao_prazos_processo" TO "authenticated";

GRANT SELECT ON TABLE public."operacao_prazos_processo" TO "authenticated";

GRANT TRIGGER ON TABLE public."operacao_prazos_processo" TO "authenticated";

GRANT TRUNCATE ON TABLE public."operacao_prazos_processo" TO "authenticated";

GRANT UPDATE ON TABLE public."operacao_prazos_processo" TO "authenticated";

GRANT DELETE ON TABLE public."operacao_prazos_processo" TO "service_role";

GRANT INSERT ON TABLE public."operacao_prazos_processo" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_prazos_processo" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_prazos_processo" TO "service_role";

GRANT SELECT ON TABLE public."operacao_prazos_processo" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_prazos_processo" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_prazos_processo" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_prazos_processo" TO "service_role";

REVOKE ALL ON TABLE public."operacao_processos" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_processos" TO "anon";

GRANT INSERT ON TABLE public."operacao_processos" TO "anon";

GRANT MAINTAIN ON TABLE public."operacao_processos" TO "anon";

GRANT REFERENCES ON TABLE public."operacao_processos" TO "anon";

GRANT SELECT ON TABLE public."operacao_processos" TO "anon";

GRANT TRIGGER ON TABLE public."operacao_processos" TO "anon";

GRANT TRUNCATE ON TABLE public."operacao_processos" TO "anon";

GRANT UPDATE ON TABLE public."operacao_processos" TO "anon";

GRANT DELETE ON TABLE public."operacao_processos" TO "authenticated";

GRANT INSERT ON TABLE public."operacao_processos" TO "authenticated";

GRANT MAINTAIN ON TABLE public."operacao_processos" TO "authenticated";

GRANT REFERENCES ON TABLE public."operacao_processos" TO "authenticated";

GRANT SELECT ON TABLE public."operacao_processos" TO "authenticated";

GRANT TRIGGER ON TABLE public."operacao_processos" TO "authenticated";

GRANT TRUNCATE ON TABLE public."operacao_processos" TO "authenticated";

GRANT UPDATE ON TABLE public."operacao_processos" TO "authenticated";

GRANT DELETE ON TABLE public."operacao_processos" TO "service_role";

GRANT INSERT ON TABLE public."operacao_processos" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_processos" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_processos" TO "service_role";

GRANT SELECT ON TABLE public."operacao_processos" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_processos" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_processos" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_processos" TO "service_role";

REVOKE ALL ON TABLE public."operacao_renovacoes_documento" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_renovacoes_documento" TO "anon";

GRANT INSERT ON TABLE public."operacao_renovacoes_documento" TO "anon";

GRANT MAINTAIN ON TABLE public."operacao_renovacoes_documento" TO "anon";

GRANT REFERENCES ON TABLE public."operacao_renovacoes_documento" TO "anon";

GRANT SELECT ON TABLE public."operacao_renovacoes_documento" TO "anon";

GRANT TRIGGER ON TABLE public."operacao_renovacoes_documento" TO "anon";

GRANT TRUNCATE ON TABLE public."operacao_renovacoes_documento" TO "anon";

GRANT UPDATE ON TABLE public."operacao_renovacoes_documento" TO "anon";

GRANT DELETE ON TABLE public."operacao_renovacoes_documento" TO "authenticated";

GRANT INSERT ON TABLE public."operacao_renovacoes_documento" TO "authenticated";

GRANT MAINTAIN ON TABLE public."operacao_renovacoes_documento" TO "authenticated";

GRANT REFERENCES ON TABLE public."operacao_renovacoes_documento" TO "authenticated";

GRANT SELECT ON TABLE public."operacao_renovacoes_documento" TO "authenticated";

GRANT TRIGGER ON TABLE public."operacao_renovacoes_documento" TO "authenticated";

GRANT TRUNCATE ON TABLE public."operacao_renovacoes_documento" TO "authenticated";

GRANT UPDATE ON TABLE public."operacao_renovacoes_documento" TO "authenticated";

GRANT DELETE ON TABLE public."operacao_renovacoes_documento" TO "service_role";

GRANT INSERT ON TABLE public."operacao_renovacoes_documento" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_renovacoes_documento" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_renovacoes_documento" TO "service_role";

GRANT SELECT ON TABLE public."operacao_renovacoes_documento" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_renovacoes_documento" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_renovacoes_documento" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_renovacoes_documento" TO "service_role";

REVOKE ALL ON TABLE public."operacao_tipos_documento" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."operacao_tipos_documento" TO "anon";

GRANT INSERT ON TABLE public."operacao_tipos_documento" TO "anon";

GRANT MAINTAIN ON TABLE public."operacao_tipos_documento" TO "anon";

GRANT REFERENCES ON TABLE public."operacao_tipos_documento" TO "anon";

GRANT SELECT ON TABLE public."operacao_tipos_documento" TO "anon";

GRANT TRIGGER ON TABLE public."operacao_tipos_documento" TO "anon";

GRANT TRUNCATE ON TABLE public."operacao_tipos_documento" TO "anon";

GRANT UPDATE ON TABLE public."operacao_tipos_documento" TO "anon";

GRANT DELETE ON TABLE public."operacao_tipos_documento" TO "authenticated";

GRANT INSERT ON TABLE public."operacao_tipos_documento" TO "authenticated";

GRANT MAINTAIN ON TABLE public."operacao_tipos_documento" TO "authenticated";

GRANT REFERENCES ON TABLE public."operacao_tipos_documento" TO "authenticated";

GRANT SELECT ON TABLE public."operacao_tipos_documento" TO "authenticated";

GRANT TRIGGER ON TABLE public."operacao_tipos_documento" TO "authenticated";

GRANT TRUNCATE ON TABLE public."operacao_tipos_documento" TO "authenticated";

GRANT UPDATE ON TABLE public."operacao_tipos_documento" TO "authenticated";

GRANT DELETE ON TABLE public."operacao_tipos_documento" TO "service_role";

GRANT INSERT ON TABLE public."operacao_tipos_documento" TO "service_role";

GRANT MAINTAIN ON TABLE public."operacao_tipos_documento" TO "service_role";

GRANT REFERENCES ON TABLE public."operacao_tipos_documento" TO "service_role";

GRANT SELECT ON TABLE public."operacao_tipos_documento" TO "service_role";

GRANT TRIGGER ON TABLE public."operacao_tipos_documento" TO "service_role";

GRANT TRUNCATE ON TABLE public."operacao_tipos_documento" TO "service_role";

GRANT UPDATE ON TABLE public."operacao_tipos_documento" TO "service_role";

REVOKE ALL ON TABLE public."dados_robo" FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public."dados_robo" TO "anon";

GRANT INSERT ON TABLE public."dados_robo" TO "anon";

GRANT MAINTAIN ON TABLE public."dados_robo" TO "anon";

GRANT REFERENCES ON TABLE public."dados_robo" TO "anon";

GRANT SELECT ON TABLE public."dados_robo" TO "anon";

GRANT TRIGGER ON TABLE public."dados_robo" TO "anon";

GRANT TRUNCATE ON TABLE public."dados_robo" TO "anon";

GRANT UPDATE ON TABLE public."dados_robo" TO "anon";

GRANT DELETE ON TABLE public."dados_robo" TO "authenticated";

GRANT INSERT ON TABLE public."dados_robo" TO "authenticated";

GRANT MAINTAIN ON TABLE public."dados_robo" TO "authenticated";

GRANT REFERENCES ON TABLE public."dados_robo" TO "authenticated";

GRANT SELECT ON TABLE public."dados_robo" TO "authenticated";

GRANT TRIGGER ON TABLE public."dados_robo" TO "authenticated";

GRANT TRUNCATE ON TABLE public."dados_robo" TO "authenticated";

GRANT UPDATE ON TABLE public."dados_robo" TO "authenticated";

GRANT DELETE ON TABLE public."dados_robo" TO "service_role";

GRANT INSERT ON TABLE public."dados_robo" TO "service_role";

GRANT MAINTAIN ON TABLE public."dados_robo" TO "service_role";

GRANT REFERENCES ON TABLE public."dados_robo" TO "service_role";

GRANT SELECT ON TABLE public."dados_robo" TO "service_role";

GRANT TRIGGER ON TABLE public."dados_robo" TO "service_role";

GRANT TRUNCATE ON TABLE public."dados_robo" TO "service_role";

GRANT UPDATE ON TABLE public."dados_robo" TO "service_role";

REVOKE ALL ON FUNCTION public.admin_tem_permissao(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.admin_tem_permissao(text) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_tem_permissao(text) TO "anon";

GRANT EXECUTE ON FUNCTION public.admin_tem_permissao(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.admin_tem_permissao(text) TO "service_role";

REVOKE ALL ON FUNCTION public.eh_membro_operacao(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.eh_membro_operacao(uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.eh_membro_operacao(uuid) TO "anon";

GRANT EXECUTE ON FUNCTION public.eh_membro_operacao(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.eh_membro_operacao(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.tem_vinculo_operacao(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.tem_vinculo_operacao(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.tem_vinculo_operacao(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.pode_acessar_empresa_operacao(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.pode_acessar_empresa_operacao(uuid,uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.pode_acessar_empresa_operacao(uuid,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.pode_acessar_processo_operacao(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.pode_acessar_processo_operacao(uuid,uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.pode_acessar_processo_operacao(uuid,uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.acesso_arquivo_operacao(text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.acesso_arquivo_operacao(text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.acesso_arquivo_operacao(text) TO "service_role";

REVOKE ALL ON FUNCTION public.eh_owner_admin_operacao(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.eh_owner_admin_operacao(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.limite_cnpjs_operacao() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.limite_cnpjs_operacao() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.limite_cnpjs_operacao() TO "service_role";

REVOKE ALL ON FUNCTION public.aceitar_convite_empresa_operacao(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.aceitar_convite_empresa_operacao(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.aceitar_convite_empresa_operacao(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.bootstrap_operacao() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.bootstrap_operacao() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.bootstrap_operacao() TO "anon";

GRANT EXECUTE ON FUNCTION public.bootstrap_operacao() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.bootstrap_operacao() TO "service_role";

REVOKE ALL ON FUNCTION public.configurar_limite_cnpjs_cliente(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.configurar_limite_cnpjs_cliente(uuid,integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.configurar_limite_cnpjs_cliente(uuid,integer) TO "service_role";

REVOKE ALL ON FUNCTION public.consultar_limite_cnpjs_cliente(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.consultar_limite_cnpjs_cliente(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.consultar_limite_cnpjs_cliente(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.criar_convite_empresa_operacao(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.criar_convite_empresa_operacao(uuid,text,text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.criar_convite_empresa_operacao(uuid,text,text) TO "service_role";

REVOKE ALL ON FUNCTION public.listar_acessos_empresa_operacao() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.listar_acessos_empresa_operacao() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.listar_acessos_empresa_operacao() TO "service_role";

REVOKE ALL ON FUNCTION public.listar_convites_empresa_operacao() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.listar_convites_empresa_operacao() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.listar_convites_empresa_operacao() TO "service_role";

REVOKE ALL ON FUNCTION public.listar_empresas_convite_operacao() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.listar_empresas_convite_operacao() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.listar_empresas_convite_operacao() TO "service_role";

REVOKE ALL ON FUNCTION public.meu_acesso_operacao() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.meu_acesso_operacao() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.meu_acesso_operacao() TO "service_role";

REVOKE ALL ON FUNCTION public.proteger_status_cliente_operacao() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.proteger_status_cliente_operacao() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.proteger_status_cliente_operacao() TO "anon";

GRANT EXECUTE ON FUNCTION public.proteger_status_cliente_operacao() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.proteger_status_cliente_operacao() TO "service_role";

REVOKE ALL ON FUNCTION public.revogar_acesso_empresa_operacao(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.revogar_acesso_empresa_operacao(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.revogar_acesso_empresa_operacao(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.revogar_convite_empresa_operacao(uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.revogar_convite_empresa_operacao(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.revogar_convite_empresa_operacao(uuid) TO "service_role";

REVOKE ALL ON FUNCTION public.verificar_limite_cnpjs_operacao() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.verificar_limite_cnpjs_operacao() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.verificar_limite_cnpjs_operacao() TO "anon";

GRANT EXECUTE ON FUNCTION public.verificar_limite_cnpjs_operacao() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.verificar_limite_cnpjs_operacao() TO "service_role";

REVOKE ALL ON FUNCTION public.criar_cliente_no_cadastro() FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.criar_cliente_no_cadastro() TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.criar_cliente_no_cadastro() TO "anon";

GRANT EXECUTE ON FUNCTION public.criar_cliente_no_cadastro() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.criar_cliente_no_cadastro() TO "service_role";

CREATE POLICY "admins_owner_atualiza" ON public."admins" AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((EXISTS ( SELECT 1
   FROM admins a
  WHERE ((a.email = (auth.jwt() ->> 'email'::text)) AND (a.role = 'owner'::text)))) AND ((auth.jwt() ->> 'aal'::text) = 'aal2'::text)));

CREATE POLICY "admins_owner_insere" ON public."admins" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((EXISTS ( SELECT 1
   FROM admins a
  WHERE ((a.email = (auth.jwt() ->> 'email'::text)) AND (a.role = 'owner'::text)))) AND ((auth.jwt() ->> 'aal'::text) = 'aal2'::text)));

CREATE POLICY "admins_owner_remove" ON public."admins" AS PERMISSIVE FOR DELETE TO PUBLIC USING (((EXISTS ( SELECT 1
   FROM admins a
  WHERE ((a.email = (auth.jwt() ->> 'email'::text)) AND (a.role = 'owner'::text)))) AND ((auth.jwt() ->> 'aal'::text) = 'aal2'::text)));

CREATE POLICY "admins_select_proprio" ON public."admins" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((auth.jwt() ->> 'email'::text) = email));

CREATE POLICY "qualquer_usuario_logado_pode_checar" ON public."admins" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "admin_atualiza_qualquer_registro" ON public."clientes" AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((admin_tem_permissao('aprovar_cadastros'::text) AND ((auth.jwt() ->> 'aal'::text) = 'aal2'::text)));

CREATE POLICY "admin_ve_todos_os_registros" ON public."clientes" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((admin_tem_permissao('aprovar_cadastros'::text) AND ((auth.jwt() ->> 'aal'::text) = 'aal2'::text)));

CREATE POLICY "cliente_ve_proprio_registro" ON public."clientes" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((auth.uid() = id));

CREATE POLICY "clientes_insert_proprio" ON public."clientes" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((auth.uid() = id));

CREATE POLICY "clientes_select_proprio" ON public."clientes" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((auth.uid() = id));

CREATE POLICY "clientes_update_proprio" ON public."clientes" AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((auth.uid() = id));

CREATE POLICY "operacao_agenda_da_empresa" ON public."operacao_agenda" AS PERMISSIVE FOR ALL TO PUBLIC USING (pode_acessar_empresa_operacao(organizacao_id, empresa_id)) WITH CHECK (pode_acessar_empresa_operacao(organizacao_id, empresa_id));

CREATE POLICY "operacao_anexos_da_empresa" ON public."operacao_anexos_processo" AS PERMISSIVE FOR ALL TO PUBLIC USING (pode_acessar_processo_operacao(organizacao_id, processo_id)) WITH CHECK ((pode_acessar_processo_operacao(organizacao_id, processo_id) AND acesso_arquivo_operacao(arquivo_caminho)));

CREATE POLICY "operacao_contratos_da_empresa" ON public."operacao_contratos" AS PERMISSIVE FOR ALL TO PUBLIC USING (pode_acessar_processo_operacao(organizacao_id, processo_id)) WITH CHECK (pode_acessar_processo_operacao(organizacao_id, processo_id));

CREATE POLICY "operacao_documentos_da_empresa" ON public."operacao_documentos" AS PERMISSIVE FOR ALL TO PUBLIC USING (pode_acessar_empresa_operacao(organizacao_id, empresa_id)) WITH CHECK (pode_acessar_empresa_operacao(organizacao_id, empresa_id));

CREATE POLICY "operacao_empenhos_da_empresa" ON public."operacao_empenhos" AS PERMISSIVE FOR ALL TO PUBLIC USING (pode_acessar_processo_operacao(organizacao_id, processo_id)) WITH CHECK (pode_acessar_processo_operacao(organizacao_id, processo_id));

CREATE POLICY "operacao_empresas_escrita" ON public."operacao_empresas" AS PERMISSIVE FOR ALL TO PUBLIC USING (eh_membro_operacao(organizacao_id)) WITH CHECK (eh_membro_operacao(organizacao_id));

CREATE POLICY "operacao_empresas_leitura" ON public."operacao_empresas" AS PERMISSIVE FOR SELECT TO PUBLIC USING (pode_acessar_empresa_operacao(organizacao_id, id));

CREATE POLICY "operacao_itens_da_empresa" ON public."operacao_itens_resultado" AS PERMISSIVE FOR ALL TO PUBLIC USING (pode_acessar_processo_operacao(organizacao_id, processo_id)) WITH CHECK (pode_acessar_processo_operacao(organizacao_id, processo_id));

CREATE POLICY "operacao_membros_da_org" ON public."operacao_membros" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((usuario_id = auth.uid()) OR eh_membro_operacao(organizacao_id)));

CREATE POLICY "operacao_ocorrencias_da_empresa" ON public."operacao_ocorrencias" AS PERMISSIVE FOR ALL TO PUBLIC USING (pode_acessar_processo_operacao(organizacao_id, processo_id)) WITH CHECK (pode_acessar_processo_operacao(organizacao_id, processo_id));

CREATE POLICY "operacao_organizacoes_proprias" ON public."operacao_organizacoes" AS PERMISSIVE FOR SELECT TO PUBLIC USING (tem_vinculo_operacao(id));

CREATE POLICY "operacao_prazos_da_empresa" ON public."operacao_prazos_processo" AS PERMISSIVE FOR ALL TO PUBLIC USING (pode_acessar_processo_operacao(organizacao_id, processo_id)) WITH CHECK (pode_acessar_processo_operacao(organizacao_id, processo_id));

CREATE POLICY "operacao_processos_da_empresa" ON public."operacao_processos" AS PERMISSIVE FOR ALL TO PUBLIC USING (pode_acessar_empresa_operacao(organizacao_id, empresa_id)) WITH CHECK (pode_acessar_empresa_operacao(organizacao_id, empresa_id));

CREATE POLICY "operacao_renovacoes_da_empresa" ON public."operacao_renovacoes_documento" AS PERMISSIVE FOR ALL TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM operacao_documentos d
  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND pode_acessar_empresa_operacao(d.organizacao_id, d.empresa_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM operacao_documentos d
  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND pode_acessar_empresa_operacao(d.organizacao_id, d.empresa_id)))));

CREATE POLICY "operacao_tipos_escrita" ON public."operacao_tipos_documento" AS PERMISSIVE FOR ALL TO PUBLIC USING (((organizacao_id IS NOT NULL) AND eh_membro_operacao(organizacao_id))) WITH CHECK (((organizacao_id IS NOT NULL) AND eh_membro_operacao(organizacao_id)));

CREATE POLICY "operacao_tipos_leitura" ON public."operacao_tipos_documento" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((organizacao_id IS NULL) OR eh_membro_operacao(organizacao_id)));

CREATE POLICY "operacao_arquivos_atualizacao" ON storage."objects" AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((bucket_id = 'operacao-documentos'::text) AND acesso_arquivo_operacao(name))) WITH CHECK (((bucket_id = 'operacao-documentos'::text) AND acesso_arquivo_operacao(name)));

CREATE POLICY "operacao_arquivos_envio" ON storage."objects" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((bucket_id = 'operacao-documentos'::text) AND acesso_arquivo_operacao(name)));

CREATE POLICY "operacao_arquivos_exclusao" ON storage."objects" AS PERMISSIVE FOR DELETE TO PUBLIC USING (((bucket_id = 'operacao-documentos'::text) AND acesso_arquivo_operacao(name)));

CREATE POLICY "operacao_arquivos_leitura" ON storage."objects" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((bucket_id = 'operacao-documentos'::text) AND acesso_arquivo_operacao(name)));

CREATE POLICY "dados_robo_select_authenticated" ON public."dados_robo" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "dados_robo_write_admin" ON public."dados_robo" AS PERMISSIVE FOR ALL TO PUBLIC USING (((auth.jwt() ->> 'email'::text) IN ( SELECT admins.email
   FROM admins))) WITH CHECK (((auth.jwt() ->> 'email'::text) IN ( SELECT admins.email
   FROM admins)));

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION criar_cliente_no_cadastro();

CREATE TRIGGER proteger_status_cliente_operacao BEFORE INSERT OR UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION proteger_status_cliente_operacao();

CREATE TRIGGER operacao_empresas_limite_cnpjs BEFORE INSERT OR UPDATE OF ativo, organizacao_id ON operacao_empresas FOR EACH ROW EXECUTE FUNCTION verificar_limite_cnpjs_operacao();

do $verificar_bootstrap$
declare observado jsonb; relacoes jsonb; funcoes jsonb; tabela text; possui_linhas boolean;
 esperado jsonb := '{"colunas":[{"acl":null,"nome":"instance_id","tipo":"uuid","ordem":1,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":2,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"aud","tipo":"character varying(255)","ordem":3,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"role","tipo":"character varying(255)","ordem":4,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"email","tipo":"character varying(255)","ordem":5,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"encrypted_password","tipo":"character varying(255)","ordem":6,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"email_confirmed_at","tipo":"timestamp with time zone","ordem":7,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"invited_at","tipo":"timestamp with time zone","ordem":8,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"confirmation_token","tipo":"character varying(255)","ordem":9,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"confirmation_sent_at","tipo":"timestamp with time zone","ordem":10,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"recovery_token","tipo":"character varying(255)","ordem":11,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"recovery_sent_at","tipo":"timestamp with time zone","ordem":12,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"email_change_token_new","tipo":"character varying(255)","ordem":13,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"email_change","tipo":"character varying(255)","ordem":14,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"email_change_sent_at","tipo":"timestamp with time zone","ordem":15,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"last_sign_in_at","tipo":"timestamp with time zone","ordem":16,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"raw_app_meta_data","tipo":"jsonb","ordem":17,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"raw_user_meta_data","tipo":"jsonb","ordem":18,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"is_super_admin","tipo":"boolean","ordem":19,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"created_at","tipo":"timestamp with time zone","ordem":20,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"updated_at","tipo":"timestamp with time zone","ordem":21,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"phone","tipo":"text","ordem":22,"tabela":"users","default":"NULL::character varying","esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"phone_confirmed_at","tipo":"timestamp with time zone","ordem":23,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"phone_change","tipo":"text","ordem":24,"tabela":"users","default":"''''::character varying","esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"phone_change_token","tipo":"character varying(255)","ordem":25,"tabela":"users","default":"''''::character varying","esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"phone_change_sent_at","tipo":"timestamp with time zone","ordem":26,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"confirmed_at","tipo":"timestamp with time zone","ordem":27,"tabela":"users","default":"LEAST(email_confirmed_at, phone_confirmed_at)","esquema":"auth","identity":"","not_null":false,"generated":"s"},{"acl":null,"nome":"email_change_token_current","tipo":"character varying(255)","ordem":28,"tabela":"users","default":"''''::character varying","esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"email_change_confirm_status","tipo":"smallint","ordem":29,"tabela":"users","default":"0","esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"banned_until","tipo":"timestamp with time zone","ordem":30,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"reauthentication_token","tipo":"character varying(255)","ordem":31,"tabela":"users","default":"''''::character varying","esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"reauthentication_sent_at","tipo":"timestamp with time zone","ordem":32,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"is_sso_user","tipo":"boolean","ordem":33,"tabela":"users","default":"false","esquema":"auth","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"deleted_at","tipo":"timestamp with time zone","ordem":34,"tabela":"users","default":null,"esquema":"auth","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"is_anonymous","tipo":"boolean","ordem":35,"tabela":"users","default":"false","esquema":"auth","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"id","tipo":"text","ordem":1,"tabela":"buckets","default":null,"esquema":"storage","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"name","tipo":"text","ordem":2,"tabela":"buckets","default":null,"esquema":"storage","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"owner","tipo":"uuid","ordem":3,"tabela":"buckets","default":null,"esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"created_at","tipo":"timestamp with time zone","ordem":4,"tabela":"buckets","default":"now()","esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"updated_at","tipo":"timestamp with time zone","ordem":5,"tabela":"buckets","default":"now()","esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"public","tipo":"boolean","ordem":6,"tabela":"buckets","default":"false","esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"avif_autodetection","tipo":"boolean","ordem":7,"tabela":"buckets","default":"false","esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"file_size_limit","tipo":"bigint","ordem":8,"tabela":"buckets","default":null,"esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"allowed_mime_types","tipo":"text[]","ordem":9,"tabela":"buckets","default":null,"esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"owner_id","tipo":"text","ordem":10,"tabela":"buckets","default":null,"esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"type","tipo":"storage.buckettype","ordem":11,"tabela":"buckets","default":"''STANDARD''::storage.buckettype","esquema":"storage","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"versioning_status","tipo":"text","ordem":12,"tabela":"buckets","default":"''DISABLED''::text","esquema":"storage","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"lifecycle_configuration","tipo":"jsonb","ordem":13,"tabela":"buckets","default":null,"esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"lifecycle_configuration_generation","tipo":"uuid","ordem":14,"tabela":"buckets","default":null,"esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"objects","default":"gen_random_uuid()","esquema":"storage","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"bucket_id","tipo":"text","ordem":2,"tabela":"objects","default":null,"esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"name","tipo":"text","ordem":3,"tabela":"objects","default":null,"esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"owner","tipo":"uuid","ordem":4,"tabela":"objects","default":null,"esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"created_at","tipo":"timestamp with time zone","ordem":5,"tabela":"objects","default":"now()","esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"updated_at","tipo":"timestamp with time zone","ordem":6,"tabela":"objects","default":"now()","esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"last_accessed_at","tipo":"timestamp with time zone","ordem":7,"tabela":"objects","default":"now()","esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"metadata","tipo":"jsonb","ordem":8,"tabela":"objects","default":null,"esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"path_tokens","tipo":"text[]","ordem":9,"tabela":"objects","default":"string_to_array(name, ''/''::text)","esquema":"storage","identity":"","not_null":false,"generated":"s"},{"acl":null,"nome":"version","tipo":"text","ordem":10,"tabela":"objects","default":null,"esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"owner_id","tipo":"text","ordem":11,"tabela":"objects","default":null,"esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"user_metadata","tipo":"jsonb","ordem":12,"tabela":"objects","default":null,"esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"archived_at","tipo":"timestamp with time zone","ordem":13,"tabela":"objects","default":null,"esquema":"storage","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"is_delete_marker","tipo":"boolean","ordem":14,"tabela":"objects","default":"false","esquema":"storage","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"is_versioned","tipo":"boolean","ordem":15,"tabela":"objects","default":"false","esquema":"storage","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"email","tipo":"text","ordem":1,"tabela":"admins","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"nome","tipo":"text","ordem":2,"tabela":"admins","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"role","tipo":"text","ordem":3,"tabela":"admins","default":"''membro''::text","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"permissoes","tipo":"jsonb","ordem":4,"tabela":"admins","default":"''[]''::jsonb","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"criado_em","tipo":"timestamp with time zone","ordem":5,"tabela":"admins","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"criado_por","tipo":"text","ordem":6,"tabela":"admins","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"nome","tipo":"text","ordem":2,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"empresa","tipo":"text","ordem":3,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"cnpj","tipo":"text","ordem":4,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"telefone","tipo":"text","ordem":5,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"email","tipo":"text","ordem":6,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"status","tipo":"text","ordem":7,"tabela":"clientes","default":"''pendente''::text","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"plano","tipo":"text","ordem":8,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"observacoes_admin","tipo":"text","ordem":9,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"criado_em","tipo":"timestamp with time zone","ordem":10,"tabela":"clientes","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"aprovado_em","tipo":"timestamp with time zone","ordem":11,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"aprovado_por","tipo":"text","ordem":12,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"segmento","tipo":"jsonb","ordem":13,"tabela":"clientes","default":"''[]''::jsonb","esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"cargo","tipo":"text","ordem":14,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"porte_empresa","tipo":"text","ordem":15,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"aceite_termos","tipo":"boolean","ordem":16,"tabela":"clientes","default":"false","esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"aceite_termos_em","tipo":"timestamp with time zone","ordem":17,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"atividades","tipo":"text","ordem":18,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"estados_interesse","tipo":"jsonb","ordem":19,"tabela":"clientes","default":"''[]''::jsonb","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"como_conheceu","tipo":"text","ordem":20,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"quantidade_funcionarios","tipo":"text","ordem":21,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"licitacoes_por_mes","tipo":"text","ordem":22,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"faturamento_anual","tipo":"text","ordem":23,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"como_pretende_usar","tipo":"text","ordem":24,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"boletim_filtro","tipo":"jsonb","ordem":25,"tabela":"clientes","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"operacao_agenda","default":"gen_random_uuid()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"organizacao_id","tipo":"uuid","ordem":2,"tabela":"operacao_agenda","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"empresa_id","tipo":"uuid","ordem":3,"tabela":"operacao_agenda","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"categoria","tipo":"text","ordem":4,"tabela":"operacao_agenda","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"titulo","tipo":"text","ordem":5,"tabela":"operacao_agenda","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"vencimento","tipo":"timestamp with time zone","ordem":6,"tabela":"operacao_agenda","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"responsavel","tipo":"text","ordem":7,"tabela":"operacao_agenda","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"observacoes","tipo":"text","ordem":8,"tabela":"operacao_agenda","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"concluido_em","tipo":"timestamp with time zone","ordem":9,"tabela":"operacao_agenda","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"criado_em","tipo":"timestamp with time zone","ordem":10,"tabela":"operacao_agenda","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"operacao_anexos_processo","default":"gen_random_uuid()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"organizacao_id","tipo":"uuid","ordem":2,"tabela":"operacao_anexos_processo","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"processo_id","tipo":"uuid","ordem":3,"tabela":"operacao_anexos_processo","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"tipo","tipo":"text","ordem":4,"tabela":"operacao_anexos_processo","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"titulo","tipo":"text","ordem":5,"tabela":"operacao_anexos_processo","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"referencia_numero","tipo":"text","ordem":6,"tabela":"operacao_anexos_processo","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"arquivo_caminho","tipo":"text","ordem":7,"tabela":"operacao_anexos_processo","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"arquivo_nome","tipo":"text","ordem":8,"tabela":"operacao_anexos_processo","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"criado_em","tipo":"timestamp with time zone","ordem":9,"tabela":"operacao_anexos_processo","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"operacao_contratos","default":"gen_random_uuid()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"organizacao_id","tipo":"uuid","ordem":2,"tabela":"operacao_contratos","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"processo_id","tipo":"uuid","ordem":3,"tabela":"operacao_contratos","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"numero","tipo":"text","ordem":4,"tabela":"operacao_contratos","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"assinado_em","tipo":"date","ordem":5,"tabela":"operacao_contratos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"vigencia_inicio","tipo":"date","ordem":6,"tabela":"operacao_contratos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"vigencia_fim","tipo":"date","ordem":7,"tabela":"operacao_contratos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"valor","tipo":"numeric(15,2)","ordem":8,"tabela":"operacao_contratos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"situacao","tipo":"text","ordem":9,"tabela":"operacao_contratos","default":"''a_assinar''::text","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"observacoes","tipo":"text","ordem":10,"tabela":"operacao_contratos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"criado_em","tipo":"timestamp with time zone","ordem":11,"tabela":"operacao_contratos","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"operacao_convites_empresa","default":"gen_random_uuid()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"organizacao_id","tipo":"uuid","ordem":2,"tabela":"operacao_convites_empresa","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"empresa_id","tipo":"uuid","ordem":3,"tabela":"operacao_convites_empresa","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"email","tipo":"text","ordem":4,"tabela":"operacao_convites_empresa","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"nome","tipo":"text","ordem":5,"tabela":"operacao_convites_empresa","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"token","tipo":"uuid","ordem":6,"tabela":"operacao_convites_empresa","default":"gen_random_uuid()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"expira_em","tipo":"timestamp with time zone","ordem":7,"tabela":"operacao_convites_empresa","default":"(now() + ''7 days''::interval)","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"aceito_em","tipo":"timestamp with time zone","ordem":8,"tabela":"operacao_convites_empresa","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"revogado_em","tipo":"timestamp with time zone","ordem":9,"tabela":"operacao_convites_empresa","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"criado_por","tipo":"uuid","ordem":10,"tabela":"operacao_convites_empresa","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"criado_em","tipo":"timestamp with time zone","ordem":11,"tabela":"operacao_convites_empresa","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"operacao_documentos","default":"gen_random_uuid()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"organizacao_id","tipo":"uuid","ordem":2,"tabela":"operacao_documentos","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"empresa_id","tipo":"uuid","ordem":3,"tabela":"operacao_documentos","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"tipo","tipo":"text","ordem":4,"tabela":"operacao_documentos","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"titulo","tipo":"text","ordem":5,"tabela":"operacao_documentos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"emissao","tipo":"date","ordem":6,"tabela":"operacao_documentos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"vencimento","tipo":"date","ordem":7,"tabela":"operacao_documentos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"orgao_emissor","tipo":"text","ordem":8,"tabela":"operacao_documentos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"responsavel","tipo":"text","ordem":9,"tabela":"operacao_documentos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"observacoes","tipo":"text","ordem":10,"tabela":"operacao_documentos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"arquivo_caminho","tipo":"text","ordem":11,"tabela":"operacao_documentos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"arquivo_nome","tipo":"text","ordem":12,"tabela":"operacao_documentos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"criado_por","tipo":"uuid","ordem":13,"tabela":"operacao_documentos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"criado_em","tipo":"timestamp with time zone","ordem":14,"tabela":"operacao_documentos","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"atualizado_em","tipo":"timestamp with time zone","ordem":15,"tabela":"operacao_documentos","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"operacao_empenhos","default":"gen_random_uuid()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"organizacao_id","tipo":"uuid","ordem":2,"tabela":"operacao_empenhos","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"processo_id","tipo":"uuid","ordem":3,"tabela":"operacao_empenhos","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"numero","tipo":"text","ordem":4,"tabela":"operacao_empenhos","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"emitido_em","tipo":"date","ordem":5,"tabela":"operacao_empenhos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"valor","tipo":"numeric(15,2)","ordem":6,"tabela":"operacao_empenhos","default":"0","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"saldo","tipo":"numeric(15,2)","ordem":7,"tabela":"operacao_empenhos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"entrega_prevista","tipo":"date","ordem":8,"tabela":"operacao_empenhos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"entregue_em","tipo":"date","ordem":9,"tabela":"operacao_empenhos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"recebido_em","tipo":"date","ordem":10,"tabela":"operacao_empenhos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"pago_em","tipo":"date","ordem":11,"tabela":"operacao_empenhos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"status","tipo":"text","ordem":12,"tabela":"operacao_empenhos","default":"''emitido''::text","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"observacoes","tipo":"text","ordem":13,"tabela":"operacao_empenhos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"criado_em","tipo":"timestamp with time zone","ordem":14,"tabela":"operacao_empenhos","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"operacao_empresas","default":"gen_random_uuid()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"organizacao_id","tipo":"uuid","ordem":2,"tabela":"operacao_empresas","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"razao_social","tipo":"text","ordem":3,"tabela":"operacao_empresas","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"cnpj","tipo":"text","ordem":4,"tabela":"operacao_empresas","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"responsavel","tipo":"text","ordem":5,"tabela":"operacao_empresas","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"ativo","tipo":"boolean","ordem":6,"tabela":"operacao_empresas","default":"true","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"criado_em","tipo":"timestamp with time zone","ordem":7,"tabela":"operacao_empresas","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"operacao_itens_resultado","default":"gen_random_uuid()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"organizacao_id","tipo":"uuid","ordem":2,"tabela":"operacao_itens_resultado","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"processo_id","tipo":"uuid","ordem":3,"tabela":"operacao_itens_resultado","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"identificador","tipo":"text","ordem":4,"tabela":"operacao_itens_resultado","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"tipo","tipo":"text","ordem":5,"tabela":"operacao_itens_resultado","default":"''item''::text","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"descricao","tipo":"text","ordem":6,"tabela":"operacao_itens_resultado","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"situacao","tipo":"text","ordem":7,"tabela":"operacao_itens_resultado","default":"''pendente''::text","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"quantidade","tipo":"numeric(15,3)","ordem":8,"tabela":"operacao_itens_resultado","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"valor_proposta","tipo":"numeric(15,2)","ordem":9,"tabela":"operacao_itens_resultado","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"valor_homologado","tipo":"numeric(15,2)","ordem":10,"tabela":"operacao_itens_resultado","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"motivo","tipo":"text","ordem":11,"tabela":"operacao_itens_resultado","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"fonte_oficial","tipo":"text","ordem":12,"tabela":"operacao_itens_resultado","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"atualizado_em","tipo":"timestamp with time zone","ordem":13,"tabela":"operacao_itens_resultado","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"marca","tipo":"text","ordem":14,"tabela":"operacao_itens_resultado","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"modelo","tipo":"text","ordem":15,"tabela":"operacao_itens_resultado","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"valor_unitario_proposta","tipo":"numeric(15,2)","ordem":16,"tabela":"operacao_itens_resultado","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"valor_unitario_homologado","tipo":"numeric(15,2)","ordem":17,"tabela":"operacao_itens_resultado","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"usuario_id","tipo":"uuid","ordem":1,"tabela":"operacao_limites_cnpj","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"limite","tipo":"integer","ordem":2,"tabela":"operacao_limites_cnpj","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"atualizado_em","tipo":"timestamp with time zone","ordem":3,"tabela":"operacao_limites_cnpj","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"organizacao_id","tipo":"uuid","ordem":1,"tabela":"operacao_membros","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"usuario_id","tipo":"uuid","ordem":2,"tabela":"operacao_membros","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"papel","tipo":"text","ordem":3,"tabela":"operacao_membros","default":"''gestor''::text","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"criado_em","tipo":"timestamp with time zone","ordem":4,"tabela":"operacao_membros","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"empresa_id","tipo":"uuid","ordem":5,"tabela":"operacao_membros","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"operacao_ocorrencias","default":"gen_random_uuid()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"organizacao_id","tipo":"uuid","ordem":2,"tabela":"operacao_ocorrencias","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"processo_id","tipo":"uuid","ordem":3,"tabela":"operacao_ocorrencias","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"ocorrido_em","tipo":"timestamp with time zone","ordem":4,"tabela":"operacao_ocorrencias","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"categoria","tipo":"text","ordem":5,"tabela":"operacao_ocorrencias","default":"''registro''::text","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"descricao","tipo":"text","ordem":6,"tabela":"operacao_ocorrencias","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"fonte_oficial","tipo":"text","ordem":7,"tabela":"operacao_ocorrencias","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"criado_em","tipo":"timestamp with time zone","ordem":8,"tabela":"operacao_ocorrencias","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"operacao_organizacoes","default":"gen_random_uuid()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"nome","tipo":"text","ordem":2,"tabela":"operacao_organizacoes","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"owner_id","tipo":"uuid","ordem":3,"tabela":"operacao_organizacoes","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"criado_em","tipo":"timestamp with time zone","ordem":4,"tabela":"operacao_organizacoes","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"operacao_prazos_processo","default":"gen_random_uuid()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"organizacao_id","tipo":"uuid","ordem":2,"tabela":"operacao_prazos_processo","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"processo_id","tipo":"uuid","ordem":3,"tabela":"operacao_prazos_processo","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"categoria","tipo":"text","ordem":4,"tabela":"operacao_prazos_processo","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"titulo","tipo":"text","ordem":5,"tabela":"operacao_prazos_processo","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"vencimento","tipo":"timestamp with time zone","ordem":6,"tabela":"operacao_prazos_processo","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"responsavel","tipo":"text","ordem":7,"tabela":"operacao_prazos_processo","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"concluido_em","tipo":"timestamp with time zone","ordem":8,"tabela":"operacao_prazos_processo","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"observacoes","tipo":"text","ordem":9,"tabela":"operacao_prazos_processo","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"criado_em","tipo":"timestamp with time zone","ordem":10,"tabela":"operacao_prazos_processo","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"operacao_processos","default":"gen_random_uuid()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"organizacao_id","tipo":"uuid","ordem":2,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"empresa_id","tipo":"uuid","ordem":3,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"numero","tipo":"text","ordem":4,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"objeto","tipo":"text","ordem":5,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"orgao","tipo":"text","ordem":6,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"modalidade","tipo":"text","ordem":7,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"url_origem","tipo":"text","ordem":8,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"status","tipo":"text","ordem":9,"tabela":"operacao_processos","default":"''triagem''::text","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"decisao","tipo":"text","ordem":10,"tabela":"operacao_processos","default":"''em_analise''::text","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"responsavel","tipo":"text","ordem":11,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"valor_estimado","tipo":"numeric(15,2)","ordem":12,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"custo_direto","tipo":"numeric(15,2)","ordem":13,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"frete","tipo":"numeric(15,2)","ordem":14,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"tributos_percentual","tipo":"numeric(7,3)","ordem":15,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"garantia_percentual","tipo":"numeric(7,3)","ordem":16,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"margem_percentual","tipo":"numeric(7,3)","ordem":17,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"preco_minimo","tipo":"numeric(15,2)","ordem":18,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"preco_proposta","tipo":"numeric(15,2)","ordem":19,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"documentos_exigidos","tipo":"text[]","ordem":20,"tabela":"operacao_processos","default":"''{}''::text[]","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"data_publicacao","tipo":"date","ordem":21,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"data_sessao","tipo":"timestamp with time zone","ordem":22,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"data_resultado","tipo":"date","ordem":23,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"resultado","tipo":"text","ordem":24,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"motivo_perda","tipo":"text","ordem":25,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"observacoes","tipo":"text","ordem":26,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"criado_por","tipo":"uuid","ordem":27,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"criado_em","tipo":"timestamp with time zone","ordem":28,"tabela":"operacao_processos","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"atualizado_em","tipo":"timestamp with time zone","ordem":29,"tabela":"operacao_processos","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"origem_externa_id","tipo":"text","ordem":30,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"sistema","tipo":"text","ordem":31,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"uasg","tipo":"text","ordem":32,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"situacao_resultado","tipo":"text","ordem":33,"tabela":"operacao_processos","default":"''nao_apurado''::text","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"valor_homologado","tipo":"numeric(15,2)","ordem":34,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"fonte_resultado","tipo":"text","ordem":35,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"checklist_fonte","tipo":"text","ordem":36,"tabela":"operacao_processos","default":"''manual''::text","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"checklist_editado_manualmente","tipo":"boolean","ordem":37,"tabela":"operacao_processos","default":"false","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"checklist_gerado_em","tipo":"timestamp with time zone","ordem":38,"tabela":"operacao_processos","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"operacao_renovacoes_documento","default":"gen_random_uuid()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"documento_id","tipo":"uuid","ordem":2,"tabela":"operacao_renovacoes_documento","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"emissao_anterior","tipo":"date","ordem":3,"tabela":"operacao_renovacoes_documento","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"vencimento_anterior","tipo":"date","ordem":4,"tabela":"operacao_renovacoes_documento","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"emissao_nova","tipo":"date","ordem":5,"tabela":"operacao_renovacoes_documento","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"vencimento_novo","tipo":"date","ordem":6,"tabela":"operacao_renovacoes_documento","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"registrado_por","tipo":"uuid","ordem":7,"tabela":"operacao_renovacoes_documento","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"registrado_em","tipo":"timestamp with time zone","ordem":8,"tabela":"operacao_renovacoes_documento","default":"now()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"id","tipo":"uuid","ordem":1,"tabela":"operacao_tipos_documento","default":"gen_random_uuid()","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"organizacao_id","tipo":"uuid","ordem":2,"tabela":"operacao_tipos_documento","default":null,"esquema":"public","identity":"","not_null":false,"generated":""},{"acl":null,"nome":"nome","tipo":"text","ordem":3,"tabela":"operacao_tipos_documento","default":null,"esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"personalizado","tipo":"boolean","ordem":4,"tabela":"operacao_tipos_documento","default":"false","esquema":"public","identity":"","not_null":true,"generated":""},{"acl":null,"nome":"chave","tipo":"text","ordem":1,"default":null,"identity":"","not_null":true,"generated":"","esquema":"public","tabela":"dados_robo"},{"acl":null,"nome":"dado","tipo":"jsonb","ordem":2,"default":null,"identity":"","not_null":true,"generated":"","esquema":"public","tabela":"dados_robo"},{"acl":null,"nome":"atualizado_em","tipo":"timestamp with time zone","ordem":3,"default":"now()","identity":"","not_null":true,"generated":"","esquema":"public","tabela":"dados_robo"}],"constraints":[{"nome":"users_email_change_confirm_status_check","tipo":"c","adiada":false,"tabela":"users","esquema":"auth","validada":true,"deferivel":false,"definicao":"CHECK (email_change_confirm_status >= 0 AND email_change_confirm_status <= 2)"},{"nome":"users_phone_key","tipo":"u","adiada":false,"tabela":"users","esquema":"auth","validada":true,"deferivel":false,"definicao":"UNIQUE (phone)"},{"nome":"users_pkey","tipo":"p","adiada":false,"tabela":"users","esquema":"auth","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"buckets_lifecycle_configuration_pair_check","tipo":"c","adiada":false,"tabela":"buckets","esquema":"storage","validada":true,"deferivel":false,"definicao":"CHECK ((lifecycle_configuration IS NULL) = (lifecycle_configuration_generation IS NULL))"},{"nome":"buckets_lifecycle_configuration_shape_check","tipo":"c","adiada":false,"tabela":"buckets","esquema":"storage","validada":true,"deferivel":false,"definicao":"CHECK (lifecycle_configuration IS NULL OR jsonb_typeof(lifecycle_configuration) = ''object''::text AND lifecycle_configuration ? ''rules''::text AND\nCASE\n    WHEN jsonb_typeof(lifecycle_configuration -> ''rules''::text) = ''array''::text THEN jsonb_array_length(lifecycle_configuration -> ''rules''::text) >= 1 AND jsonb_array_length(lifecycle_configuration -> ''rules''::text) <= 1000\n    ELSE false\nEND)"},{"nome":"buckets_lifecycle_configuration_standard_only_check","tipo":"c","adiada":false,"tabela":"buckets","esquema":"storage","validada":true,"deferivel":false,"definicao":"CHECK (type = ''STANDARD''::storage.buckettype OR lifecycle_configuration IS NULL AND lifecycle_configuration_generation IS NULL)"},{"nome":"buckets_pkey","tipo":"p","adiada":false,"tabela":"buckets","esquema":"storage","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"buckets_versioning_dark_check","tipo":"c","adiada":false,"tabela":"buckets","esquema":"storage","validada":true,"deferivel":false,"definicao":"CHECK (versioning_status = ''DISABLED''::text)"},{"nome":"buckets_versioning_standard_only_check","tipo":"c","adiada":false,"tabela":"buckets","esquema":"storage","validada":true,"deferivel":false,"definicao":"CHECK (type = ''STANDARD''::storage.buckettype OR versioning_status = ''DISABLED''::text)"},{"nome":"buckets_versioning_status_check","tipo":"c","adiada":false,"tabela":"buckets","esquema":"storage","validada":true,"deferivel":false,"definicao":"CHECK (versioning_status = ANY (ARRAY[''DISABLED''::text, ''ENABLED''::text, ''SUSPENDED''::text]))"},{"nome":"objects_bucketId_fkey","tipo":"f","adiada":false,"tabela":"objects","esquema":"storage","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id)"},{"nome":"objects_pkey","tipo":"p","adiada":false,"tabela":"objects","esquema":"storage","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"admins_pkey","tipo":"p","adiada":false,"tabela":"admins","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (email)"},{"nome":"admins_role_check","tipo":"c","adiada":false,"tabela":"admins","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (role = ANY (ARRAY[''owner''::text, ''membro''::text]))"},{"nome":"clientes_boletim_filtro_valido","tipo":"c","adiada":false,"tabela":"clientes","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (boletim_filtro IS NULL OR jsonb_typeof(boletim_filtro) = ''object''::text AND jsonb_typeof(boletim_filtro -> ''ufs''::text) = ''array''::text AND jsonb_typeof(boletim_filtro -> ''palavrasRaw''::text) = ''string''::text AND jsonb_array_length(boletim_filtro -> ''ufs''::text) <= 27 AND length(btrim(boletim_filtro ->> ''palavrasRaw''::text)) >= 1 AND length(btrim(boletim_filtro ->> ''palavrasRaw''::text)) <= 1000 AND octet_length(boletim_filtro::text) <= 4000 AND boletim_filtro ?& ARRAY[''ufs''::text, ''palavrasRaw''::text])"},{"nome":"clientes_id_fkey","tipo":"f","adiada":false,"tabela":"clientes","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE"},{"nome":"clientes_pkey","tipo":"p","adiada":false,"tabela":"clientes","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"clientes_status_check","tipo":"c","adiada":false,"tabela":"clientes","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (status = ANY (ARRAY[''pendente''::text, ''aprovado''::text, ''rejeitado''::text]))"},{"nome":"operacao_agenda_categoria_check","tipo":"c","adiada":false,"tabela":"operacao_agenda","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (categoria = ANY (ARRAY[''sessao''::text, ''esclarecimento''::text, ''impugnacao''::text, ''proposta''::text, ''diligencia''::text, ''recurso''::text, ''entrega''::text, ''vigencia''::text, ''reajuste''::text, ''repactuacao''::text, ''renovacao''::text, ''outro''::text]))"},{"nome":"operacao_agenda_empresa_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_agenda","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (empresa_id) REFERENCES operacao_empresas(id) ON DELETE CASCADE"},{"nome":"operacao_agenda_organizacao_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_agenda","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE"},{"nome":"operacao_agenda_pkey","tipo":"p","adiada":false,"tabela":"operacao_agenda","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"operacao_anexos_processo_pkey","tipo":"p","adiada":false,"tabela":"operacao_anexos_processo","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"operacao_anexos_processo_processo_id_organizacao_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_anexos_processo","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (processo_id, organizacao_id) REFERENCES operacao_processos(id, organizacao_id) ON DELETE CASCADE"},{"nome":"operacao_anexos_processo_tipo_check","tipo":"c","adiada":false,"tabela":"operacao_anexos_processo","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (tipo = ANY (ARRAY[''edital''::text, ''proposta''::text, ''habilitacao''::text, ''homologacao''::text, ''contrato''::text, ''empenho''::text, ''ata''::text, ''outro''::text]))"},{"nome":"operacao_contratos_pkey","tipo":"p","adiada":false,"tabela":"operacao_contratos","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"operacao_contratos_processo_id_numero_key","tipo":"u","adiada":false,"tabela":"operacao_contratos","esquema":"public","validada":true,"deferivel":false,"definicao":"UNIQUE (processo_id, numero)"},{"nome":"operacao_contratos_processo_id_organizacao_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_contratos","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (processo_id, organizacao_id) REFERENCES operacao_processos(id, organizacao_id) ON DELETE CASCADE"},{"nome":"operacao_contratos_situacao_check","tipo":"c","adiada":false,"tabela":"operacao_contratos","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (situacao = ANY (ARRAY[''a_assinar''::text, ''vigente''::text, ''encerrado''::text, ''rescindido''::text]))"},{"nome":"operacao_contratos_valor_check","tipo":"c","adiada":false,"tabela":"operacao_contratos","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (valor IS NULL OR valor >= 0::numeric)"},{"nome":"operacao_convites_empresa_criado_por_fkey","tipo":"f","adiada":false,"tabela":"operacao_convites_empresa","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (criado_por) REFERENCES auth.users(id)"},{"nome":"operacao_convites_empresa_empresa_id_organizacao_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_convites_empresa","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (empresa_id, organizacao_id) REFERENCES operacao_empresas(id, organizacao_id) ON DELETE CASCADE"},{"nome":"operacao_convites_empresa_organizacao_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_convites_empresa","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE"},{"nome":"operacao_convites_empresa_pkey","tipo":"p","adiada":false,"tabela":"operacao_convites_empresa","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"operacao_convites_empresa_token_key","tipo":"u","adiada":false,"tabela":"operacao_convites_empresa","esquema":"public","validada":true,"deferivel":false,"definicao":"UNIQUE (token)"},{"nome":"operacao_documentos_criado_por_fkey","tipo":"f","adiada":false,"tabela":"operacao_documentos","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (criado_por) REFERENCES auth.users(id)"},{"nome":"operacao_documentos_empresa_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_documentos","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (empresa_id) REFERENCES operacao_empresas(id) ON DELETE CASCADE"},{"nome":"operacao_documentos_organizacao_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_documentos","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE"},{"nome":"operacao_documentos_pkey","tipo":"p","adiada":false,"tabela":"operacao_documentos","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"operacao_empenhos_organizacao_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_empenhos","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE"},{"nome":"operacao_empenhos_pkey","tipo":"p","adiada":false,"tabela":"operacao_empenhos","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"operacao_empenhos_processo_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_empenhos","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (processo_id) REFERENCES operacao_processos(id) ON DELETE CASCADE"},{"nome":"operacao_empenhos_processo_id_numero_key","tipo":"u","adiada":false,"tabela":"operacao_empenhos","esquema":"public","validada":true,"deferivel":false,"definicao":"UNIQUE (processo_id, numero)"},{"nome":"operacao_empenhos_saldo_check","tipo":"c","adiada":false,"tabela":"operacao_empenhos","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (saldo IS NULL OR saldo >= 0::numeric)"},{"nome":"operacao_empenhos_status_check","tipo":"c","adiada":false,"tabela":"operacao_empenhos","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (status = ANY (ARRAY[''emitido''::text, ''em_execucao''::text, ''entregue''::text, ''recebido''::text, ''pago''::text, ''cancelado''::text]))"},{"nome":"operacao_empenhos_valor_check","tipo":"c","adiada":false,"tabela":"operacao_empenhos","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (valor >= 0::numeric)"},{"nome":"operacao_empresas_organizacao_id_cnpj_key","tipo":"u","adiada":false,"tabela":"operacao_empresas","esquema":"public","validada":true,"deferivel":false,"definicao":"UNIQUE (organizacao_id, cnpj)"},{"nome":"operacao_empresas_organizacao_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_empresas","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE"},{"nome":"operacao_empresas_pkey","tipo":"p","adiada":false,"tabela":"operacao_empresas","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"operacao_itens_resultado_check","tipo":"c","adiada":false,"tabela":"operacao_itens_resultado","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (valor_homologado IS NULL OR valor_homologado >= 0::numeric AND situacao = ''ganho''::text)"},{"nome":"operacao_itens_resultado_check1","tipo":"c","adiada":false,"tabela":"operacao_itens_resultado","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (valor_unitario_homologado IS NULL OR valor_unitario_homologado >= 0::numeric AND situacao = ''ganho''::text)"},{"nome":"operacao_itens_resultado_pkey","tipo":"p","adiada":false,"tabela":"operacao_itens_resultado","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"operacao_itens_resultado_processo_id_organizacao_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_itens_resultado","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (processo_id, organizacao_id) REFERENCES operacao_processos(id, organizacao_id) ON DELETE CASCADE"},{"nome":"operacao_itens_resultado_processo_id_tipo_identificador_key","tipo":"u","adiada":false,"tabela":"operacao_itens_resultado","esquema":"public","validada":true,"deferivel":false,"definicao":"UNIQUE (processo_id, tipo, identificador)"},{"nome":"operacao_itens_resultado_quantidade_check","tipo":"c","adiada":false,"tabela":"operacao_itens_resultado","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (quantidade IS NULL OR quantidade >= 0::numeric)"},{"nome":"operacao_itens_resultado_situacao_check","tipo":"c","adiada":false,"tabela":"operacao_itens_resultado","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (situacao = ANY (ARRAY[''pendente''::text, ''ganho''::text, ''perdido''::text, ''desclassificado''::text, ''inabilitado''::text, ''nao_disputado''::text, ''cancelado''::text]))"},{"nome":"operacao_itens_resultado_tipo_check","tipo":"c","adiada":false,"tabela":"operacao_itens_resultado","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (tipo = ANY (ARRAY[''item''::text, ''lote''::text]))"},{"nome":"operacao_itens_resultado_valor_proposta_check","tipo":"c","adiada":false,"tabela":"operacao_itens_resultado","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (valor_proposta IS NULL OR valor_proposta >= 0::numeric)"},{"nome":"operacao_itens_resultado_valor_unitario_proposta_check","tipo":"c","adiada":false,"tabela":"operacao_itens_resultado","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (valor_unitario_proposta IS NULL OR valor_unitario_proposta >= 0::numeric)"},{"nome":"operacao_limites_cnpj_limite_check","tipo":"c","adiada":false,"tabela":"operacao_limites_cnpj","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (limite >= 1 AND limite <= 3)"},{"nome":"operacao_limites_cnpj_pkey","tipo":"p","adiada":false,"tabela":"operacao_limites_cnpj","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (usuario_id)"},{"nome":"operacao_limites_cnpj_usuario_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_limites_cnpj","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE"},{"nome":"operacao_membros_empresa_org_fk","tipo":"f","adiada":false,"tabela":"operacao_membros","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (empresa_id, organizacao_id) REFERENCES operacao_empresas(id, organizacao_id) ON DELETE CASCADE"},{"nome":"operacao_membros_organizacao_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_membros","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE"},{"nome":"operacao_membros_papel_check","tipo":"c","adiada":false,"tabela":"operacao_membros","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (papel = ANY (ARRAY[''gestor''::text, ''operador''::text, ''leitura''::text]))"},{"nome":"operacao_membros_pkey","tipo":"p","adiada":false,"tabela":"operacao_membros","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (organizacao_id, usuario_id)"},{"nome":"operacao_membros_usuario_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_membros","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE"},{"nome":"operacao_ocorrencias_categoria_check","tipo":"c","adiada":false,"tabela":"operacao_ocorrencias","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (categoria = ANY (ARRAY[''registro''::text, ''sessao''::text, ''chat''::text, ''diligencia''::text, ''recurso''::text, ''resultado''::text, ''contrato''::text, ''execucao''::text]))"},{"nome":"operacao_ocorrencias_pkey","tipo":"p","adiada":false,"tabela":"operacao_ocorrencias","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"operacao_ocorrencias_processo_id_organizacao_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_ocorrencias","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (processo_id, organizacao_id) REFERENCES operacao_processos(id, organizacao_id) ON DELETE CASCADE"},{"nome":"operacao_organizacoes_owner_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_organizacoes","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE"},{"nome":"operacao_organizacoes_owner_id_key","tipo":"u","adiada":false,"tabela":"operacao_organizacoes","esquema":"public","validada":true,"deferivel":false,"definicao":"UNIQUE (owner_id)"},{"nome":"operacao_organizacoes_pkey","tipo":"p","adiada":false,"tabela":"operacao_organizacoes","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"operacao_prazos_processo_categoria_check","tipo":"c","adiada":false,"tabela":"operacao_prazos_processo","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (categoria = ANY (ARRAY[''esclarecimento''::text, ''impugnacao''::text, ''proposta''::text, ''sessao''::text, ''diligencia''::text, ''recurso''::text, ''assinatura''::text, ''entrega''::text, ''outro''::text]))"},{"nome":"operacao_prazos_processo_organizacao_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_prazos_processo","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE"},{"nome":"operacao_prazos_processo_pkey","tipo":"p","adiada":false,"tabela":"operacao_prazos_processo","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"operacao_prazos_processo_processo_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_prazos_processo","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (processo_id) REFERENCES operacao_processos(id) ON DELETE CASCADE"},{"nome":"operacao_processos_criado_por_fkey","tipo":"f","adiada":false,"tabela":"operacao_processos","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (criado_por) REFERENCES auth.users(id)"},{"nome":"operacao_processos_decisao_check","tipo":"c","adiada":false,"tabela":"operacao_processos","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (decisao = ANY (ARRAY[''em_analise''::text, ''participar''::text, ''nao_participar''::text]))"},{"nome":"operacao_processos_empresa_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_processos","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (empresa_id) REFERENCES operacao_empresas(id) ON DELETE CASCADE"},{"nome":"operacao_processos_organizacao_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_processos","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE"},{"nome":"operacao_processos_pkey","tipo":"p","adiada":false,"tabela":"operacao_processos","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"operacao_processos_resultado_valido","tipo":"c","adiada":false,"tabela":"operacao_processos","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (situacao_resultado = ANY (ARRAY[''nao_apurado''::text, ''nao_participou''::text, ''em_disputa''::text, ''sem_vitoria''::text, ''vitoria_sem_detalhamento''::text, ''vitoria_parcial''::text, ''vitoria_total''::text, ''revogado_anulado''::text]))"},{"nome":"operacao_processos_status_check","tipo":"c","adiada":false,"tabela":"operacao_processos","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (status = ANY (ARRAY[''triagem''::text, ''preparacao''::text, ''proposta_enviada''::text, ''sessao''::text, ''habilitacao''::text, ''recurso''::text, ''homologado''::text, ''contratado''::text, ''perdido''::text, ''arquivado''::text]))"},{"nome":"operacao_processos_valor_homologado_valido","tipo":"c","adiada":false,"tabela":"operacao_processos","esquema":"public","validada":true,"deferivel":false,"definicao":"CHECK (valor_homologado IS NULL OR valor_homologado >= 0::numeric)"},{"nome":"operacao_renovacoes_documento_documento_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_renovacoes_documento","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (documento_id) REFERENCES operacao_documentos(id) ON DELETE CASCADE"},{"nome":"operacao_renovacoes_documento_pkey","tipo":"p","adiada":false,"tabela":"operacao_renovacoes_documento","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"operacao_renovacoes_documento_registrado_por_fkey","tipo":"f","adiada":false,"tabela":"operacao_renovacoes_documento","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (registrado_por) REFERENCES auth.users(id)"},{"nome":"operacao_tipos_documento_organizacao_id_fkey","tipo":"f","adiada":false,"tabela":"operacao_tipos_documento","esquema":"public","validada":true,"deferivel":false,"definicao":"FOREIGN KEY (organizacao_id) REFERENCES operacao_organizacoes(id) ON DELETE CASCADE"},{"nome":"operacao_tipos_documento_organizacao_id_nome_key","tipo":"u","adiada":false,"tabela":"operacao_tipos_documento","esquema":"public","validada":true,"deferivel":false,"definicao":"UNIQUE (organizacao_id, nome)"},{"nome":"operacao_tipos_documento_pkey","tipo":"p","adiada":false,"tabela":"operacao_tipos_documento","esquema":"public","validada":true,"deferivel":false,"definicao":"PRIMARY KEY (id)"},{"nome":"dados_robo_pkey","tipo":"p","definicao":"PRIMARY KEY (chave)","esquema":"public","tabela":"dados_robo","validada":true,"deferivel":false,"adiada":false}],"indices":[{"nome":"confirmation_token_idx","unico":true,"pronto":true,"tabela":"users","valido":true,"esquema":"auth","primario":false,"definicao":"CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ ''^[0-9 ]*$''::text)"},{"nome":"email_change_token_current_idx","unico":true,"pronto":true,"tabela":"users","valido":true,"esquema":"auth","primario":false,"definicao":"CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ ''^[0-9 ]*$''::text)"},{"nome":"email_change_token_new_idx","unico":true,"pronto":true,"tabela":"users","valido":true,"esquema":"auth","primario":false,"definicao":"CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ ''^[0-9 ]*$''::text)"},{"nome":"idx_users_created_at_desc","unico":false,"pronto":true,"tabela":"users","valido":true,"esquema":"auth","primario":false,"definicao":"CREATE INDEX idx_users_created_at_desc ON auth.users USING btree (created_at DESC)"},{"nome":"idx_users_email","unico":false,"pronto":true,"tabela":"users","valido":true,"esquema":"auth","primario":false,"definicao":"CREATE INDEX idx_users_email ON auth.users USING btree (email)"},{"nome":"idx_users_last_sign_in_at_desc","unico":false,"pronto":true,"tabela":"users","valido":true,"esquema":"auth","primario":false,"definicao":"CREATE INDEX idx_users_last_sign_in_at_desc ON auth.users USING btree (last_sign_in_at DESC)"},{"nome":"idx_users_name","unico":false,"pronto":true,"tabela":"users","valido":true,"esquema":"auth","primario":false,"definicao":"CREATE INDEX idx_users_name ON auth.users USING btree (((raw_user_meta_data ->> ''name''::text))) WHERE ((raw_user_meta_data ->> ''name''::text) IS NOT NULL)"},{"nome":"reauthentication_token_idx","unico":true,"pronto":true,"tabela":"users","valido":true,"esquema":"auth","primario":false,"definicao":"CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ ''^[0-9 ]*$''::text)"},{"nome":"recovery_token_idx","unico":true,"pronto":true,"tabela":"users","valido":true,"esquema":"auth","primario":false,"definicao":"CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ ''^[0-9 ]*$''::text)"},{"nome":"users_email_partial_key","unico":true,"pronto":true,"tabela":"users","valido":true,"esquema":"auth","primario":false,"definicao":"CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false)"},{"nome":"users_instance_id_email_idx","unico":false,"pronto":true,"tabela":"users","valido":true,"esquema":"auth","primario":false,"definicao":"CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text))"},{"nome":"users_instance_id_idx","unico":false,"pronto":true,"tabela":"users","valido":true,"esquema":"auth","primario":false,"definicao":"CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id)"},{"nome":"users_is_anonymous_idx","unico":false,"pronto":true,"tabela":"users","valido":true,"esquema":"auth","primario":false,"definicao":"CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous)"},{"nome":"users_phone_key","unico":true,"pronto":true,"tabela":"users","valido":true,"esquema":"auth","primario":false,"definicao":"CREATE UNIQUE INDEX users_phone_key ON auth.users USING btree (phone)"},{"nome":"users_pkey","unico":true,"pronto":true,"tabela":"users","valido":true,"esquema":"auth","primario":true,"definicao":"CREATE UNIQUE INDEX users_pkey ON auth.users USING btree (id)"},{"nome":"bname","unico":true,"pronto":true,"tabela":"buckets","valido":true,"esquema":"storage","primario":false,"definicao":"CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name)"},{"nome":"buckets_pkey","unico":true,"pronto":true,"tabela":"buckets","valido":true,"esquema":"storage","primario":true,"definicao":"CREATE UNIQUE INDEX buckets_pkey ON storage.buckets USING btree (id)"},{"nome":"idx_objects_bucket_id_name","unico":false,"pronto":true,"tabela":"objects","valido":true,"esquema":"storage","primario":false,"definicao":"CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE \"C\")"},{"nome":"idx_objects_bucket_id_name_lower","unico":false,"pronto":true,"tabela":"objects","valido":true,"esquema":"storage","primario":false,"definicao":"CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE \"C\")"},{"nome":"idx_objects_current_version","unico":true,"pronto":true,"tabela":"objects","valido":true,"esquema":"storage","primario":false,"definicao":"CREATE UNIQUE INDEX idx_objects_current_version ON storage.objects USING btree (bucket_id, name COLLATE \"C\") WHERE (archived_at IS NULL)"},{"nome":"idx_objects_delete_markers","unico":false,"pronto":true,"tabela":"objects","valido":true,"esquema":"storage","primario":false,"definicao":"CREATE INDEX idx_objects_delete_markers ON storage.objects USING btree (bucket_id, name COLLATE \"C\") WHERE is_delete_marker"},{"nome":"idx_objects_null_version","unico":true,"pronto":true,"tabela":"objects","valido":true,"esquema":"storage","primario":false,"definicao":"CREATE UNIQUE INDEX idx_objects_null_version ON storage.objects USING btree (bucket_id, name COLLATE \"C\") WHERE (NOT is_versioned)"},{"nome":"name_prefix_search","unico":false,"pronto":true,"tabela":"objects","valido":true,"esquema":"storage","primario":false,"definicao":"CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops)"},{"nome":"objects_bucket_id_name_version_key","unico":true,"pronto":true,"tabela":"objects","valido":true,"esquema":"storage","primario":false,"definicao":"CREATE UNIQUE INDEX objects_bucket_id_name_version_key ON storage.objects USING btree (bucket_id, name COLLATE \"C\", version) NULLS NOT DISTINCT"},{"nome":"objects_pkey","unico":true,"pronto":true,"tabela":"objects","valido":true,"esquema":"storage","primario":true,"definicao":"CREATE UNIQUE INDEX objects_pkey ON storage.objects USING btree (id)"},{"nome":"admins_pkey","unico":true,"pronto":true,"tabela":"admins","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX admins_pkey ON public.admins USING btree (email)"},{"nome":"clientes_pkey","unico":true,"pronto":true,"tabela":"clientes","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX clientes_pkey ON public.clientes USING btree (id)"},{"nome":"operacao_agenda_organizacao_vencimento_idx","unico":false,"pronto":true,"tabela":"operacao_agenda","valido":true,"esquema":"public","primario":false,"definicao":"CREATE INDEX operacao_agenda_organizacao_vencimento_idx ON public.operacao_agenda USING btree (organizacao_id, vencimento)"},{"nome":"operacao_agenda_pkey","unico":true,"pronto":true,"tabela":"operacao_agenda","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_agenda_pkey ON public.operacao_agenda USING btree (id)"},{"nome":"operacao_anexos_processo_idx","unico":false,"pronto":true,"tabela":"operacao_anexos_processo","valido":true,"esquema":"public","primario":false,"definicao":"CREATE INDEX operacao_anexos_processo_idx ON public.operacao_anexos_processo USING btree (processo_id, criado_em DESC)"},{"nome":"operacao_anexos_processo_pkey","unico":true,"pronto":true,"tabela":"operacao_anexos_processo","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_anexos_processo_pkey ON public.operacao_anexos_processo USING btree (id)"},{"nome":"operacao_contratos_pkey","unico":true,"pronto":true,"tabela":"operacao_contratos","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_contratos_pkey ON public.operacao_contratos USING btree (id)"},{"nome":"operacao_contratos_processo_id_numero_key","unico":true,"pronto":true,"tabela":"operacao_contratos","valido":true,"esquema":"public","primario":false,"definicao":"CREATE UNIQUE INDEX operacao_contratos_processo_id_numero_key ON public.operacao_contratos USING btree (processo_id, numero)"},{"nome":"operacao_contratos_processo_idx","unico":false,"pronto":true,"tabela":"operacao_contratos","valido":true,"esquema":"public","primario":false,"definicao":"CREATE INDEX operacao_contratos_processo_idx ON public.operacao_contratos USING btree (processo_id)"},{"nome":"operacao_convites_empresa_pkey","unico":true,"pronto":true,"tabela":"operacao_convites_empresa","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_convites_empresa_pkey ON public.operacao_convites_empresa USING btree (id)"},{"nome":"operacao_convites_empresa_token_key","unico":true,"pronto":true,"tabela":"operacao_convites_empresa","valido":true,"esquema":"public","primario":false,"definicao":"CREATE UNIQUE INDEX operacao_convites_empresa_token_key ON public.operacao_convites_empresa USING btree (token)"},{"nome":"operacao_documentos_empresa_vencimento_idx","unico":false,"pronto":true,"tabela":"operacao_documentos","valido":true,"esquema":"public","primario":false,"definicao":"CREATE INDEX operacao_documentos_empresa_vencimento_idx ON public.operacao_documentos USING btree (empresa_id, vencimento)"},{"nome":"operacao_documentos_pkey","unico":true,"pronto":true,"tabela":"operacao_documentos","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_documentos_pkey ON public.operacao_documentos USING btree (id)"},{"nome":"operacao_empenhos_pkey","unico":true,"pronto":true,"tabela":"operacao_empenhos","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_empenhos_pkey ON public.operacao_empenhos USING btree (id)"},{"nome":"operacao_empenhos_processo_id_numero_key","unico":true,"pronto":true,"tabela":"operacao_empenhos","valido":true,"esquema":"public","primario":false,"definicao":"CREATE UNIQUE INDEX operacao_empenhos_processo_id_numero_key ON public.operacao_empenhos USING btree (processo_id, numero)"},{"nome":"operacao_empenhos_processo_status_idx","unico":false,"pronto":true,"tabela":"operacao_empenhos","valido":true,"esquema":"public","primario":false,"definicao":"CREATE INDEX operacao_empenhos_processo_status_idx ON public.operacao_empenhos USING btree (processo_id, status)"},{"nome":"operacao_empresas_id_org_idx","unico":true,"pronto":true,"tabela":"operacao_empresas","valido":true,"esquema":"public","primario":false,"definicao":"CREATE UNIQUE INDEX operacao_empresas_id_org_idx ON public.operacao_empresas USING btree (id, organizacao_id)"},{"nome":"operacao_empresas_organizacao_id_cnpj_key","unico":true,"pronto":true,"tabela":"operacao_empresas","valido":true,"esquema":"public","primario":false,"definicao":"CREATE UNIQUE INDEX operacao_empresas_organizacao_id_cnpj_key ON public.operacao_empresas USING btree (organizacao_id, cnpj)"},{"nome":"operacao_empresas_pkey","unico":true,"pronto":true,"tabela":"operacao_empresas","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_empresas_pkey ON public.operacao_empresas USING btree (id)"},{"nome":"operacao_itens_resultado_pkey","unico":true,"pronto":true,"tabela":"operacao_itens_resultado","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_itens_resultado_pkey ON public.operacao_itens_resultado USING btree (id)"},{"nome":"operacao_itens_resultado_processo_id_tipo_identificador_key","unico":true,"pronto":true,"tabela":"operacao_itens_resultado","valido":true,"esquema":"public","primario":false,"definicao":"CREATE UNIQUE INDEX operacao_itens_resultado_processo_id_tipo_identificador_key ON public.operacao_itens_resultado USING btree (processo_id, tipo, identificador)"},{"nome":"operacao_itens_resultado_processo_idx","unico":false,"pronto":true,"tabela":"operacao_itens_resultado","valido":true,"esquema":"public","primario":false,"definicao":"CREATE INDEX operacao_itens_resultado_processo_idx ON public.operacao_itens_resultado USING btree (processo_id, identificador)"},{"nome":"operacao_limites_cnpj_pkey","unico":true,"pronto":true,"tabela":"operacao_limites_cnpj","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_limites_cnpj_pkey ON public.operacao_limites_cnpj USING btree (usuario_id)"},{"nome":"operacao_membros_pkey","unico":true,"pronto":true,"tabela":"operacao_membros","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_membros_pkey ON public.operacao_membros USING btree (organizacao_id, usuario_id)"},{"nome":"operacao_ocorrencias_pkey","unico":true,"pronto":true,"tabela":"operacao_ocorrencias","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_ocorrencias_pkey ON public.operacao_ocorrencias USING btree (id)"},{"nome":"operacao_ocorrencias_processo_data_idx","unico":false,"pronto":true,"tabela":"operacao_ocorrencias","valido":true,"esquema":"public","primario":false,"definicao":"CREATE INDEX operacao_ocorrencias_processo_data_idx ON public.operacao_ocorrencias USING btree (processo_id, ocorrido_em DESC)"},{"nome":"operacao_organizacoes_owner_id_key","unico":true,"pronto":true,"tabela":"operacao_organizacoes","valido":true,"esquema":"public","primario":false,"definicao":"CREATE UNIQUE INDEX operacao_organizacoes_owner_id_key ON public.operacao_organizacoes USING btree (owner_id)"},{"nome":"operacao_organizacoes_pkey","unico":true,"pronto":true,"tabela":"operacao_organizacoes","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_organizacoes_pkey ON public.operacao_organizacoes USING btree (id)"},{"nome":"operacao_prazos_processo_pkey","unico":true,"pronto":true,"tabela":"operacao_prazos_processo","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_prazos_processo_pkey ON public.operacao_prazos_processo USING btree (id)"},{"nome":"operacao_prazos_processo_vencimento_idx","unico":false,"pronto":true,"tabela":"operacao_prazos_processo","valido":true,"esquema":"public","primario":false,"definicao":"CREATE INDEX operacao_prazos_processo_vencimento_idx ON public.operacao_prazos_processo USING btree (processo_id, vencimento)"},{"nome":"operacao_processos_empresa_status_idx","unico":false,"pronto":true,"tabela":"operacao_processos","valido":true,"esquema":"public","primario":false,"definicao":"CREATE INDEX operacao_processos_empresa_status_idx ON public.operacao_processos USING btree (empresa_id, status)"},{"nome":"operacao_processos_id_org_idx","unico":true,"pronto":true,"tabela":"operacao_processos","valido":true,"esquema":"public","primario":false,"definicao":"CREATE UNIQUE INDEX operacao_processos_id_org_idx ON public.operacao_processos USING btree (id, organizacao_id)"},{"nome":"operacao_processos_organizacao_sessao_idx","unico":false,"pronto":true,"tabela":"operacao_processos","valido":true,"esquema":"public","primario":false,"definicao":"CREATE INDEX operacao_processos_organizacao_sessao_idx ON public.operacao_processos USING btree (organizacao_id, data_sessao)"},{"nome":"operacao_processos_origem_externa_unica_idx","unico":true,"pronto":true,"tabela":"operacao_processos","valido":true,"esquema":"public","primario":false,"definicao":"CREATE UNIQUE INDEX operacao_processos_origem_externa_unica_idx ON public.operacao_processos USING btree (organizacao_id, empresa_id, origem_externa_id) WHERE (origem_externa_id IS NOT NULL)"},{"nome":"operacao_processos_pkey","unico":true,"pronto":true,"tabela":"operacao_processos","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_processos_pkey ON public.operacao_processos USING btree (id)"},{"nome":"operacao_renovacoes_documento_pkey","unico":true,"pronto":true,"tabela":"operacao_renovacoes_documento","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_renovacoes_documento_pkey ON public.operacao_renovacoes_documento USING btree (id)"},{"nome":"operacao_tipos_documento_organizacao_id_nome_key","unico":true,"pronto":true,"tabela":"operacao_tipos_documento","valido":true,"esquema":"public","primario":false,"definicao":"CREATE UNIQUE INDEX operacao_tipos_documento_organizacao_id_nome_key ON public.operacao_tipos_documento USING btree (organizacao_id, nome)"},{"nome":"operacao_tipos_documento_pkey","unico":true,"pronto":true,"tabela":"operacao_tipos_documento","valido":true,"esquema":"public","primario":true,"definicao":"CREATE UNIQUE INDEX operacao_tipos_documento_pkey ON public.operacao_tipos_documento USING btree (id)"},{"nome":"dados_robo_pkey","definicao":"CREATE UNIQUE INDEX dados_robo_pkey ON public.dados_robo USING btree (chave)","esquema":"public","tabela":"dados_robo","unico":true,"pronto":true,"valido":true,"primario":true}],"policies":[{"nome":"admins_owner_atualiza","check":null,"using":"((EXISTS ( SELECT 1\n   FROM admins a\n  WHERE ((a.email = (auth.jwt() ->> ''email''::text)) AND (a.role = ''owner''::text)))) AND ((auth.jwt() ->> ''aal''::text) = ''aal2''::text))","papeis":["public"],"tabela":"admins","comando":"UPDATE","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"admins_owner_insere","check":"((EXISTS ( SELECT 1\n   FROM admins a\n  WHERE ((a.email = (auth.jwt() ->> ''email''::text)) AND (a.role = ''owner''::text)))) AND ((auth.jwt() ->> ''aal''::text) = ''aal2''::text))","using":null,"papeis":["public"],"tabela":"admins","comando":"INSERT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"admins_owner_remove","check":null,"using":"((EXISTS ( SELECT 1\n   FROM admins a\n  WHERE ((a.email = (auth.jwt() ->> ''email''::text)) AND (a.role = ''owner''::text)))) AND ((auth.jwt() ->> ''aal''::text) = ''aal2''::text))","papeis":["public"],"tabela":"admins","comando":"DELETE","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"admins_select_proprio","check":null,"using":"((auth.jwt() ->> ''email''::text) = email)","papeis":["public"],"tabela":"admins","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"qualquer_usuario_logado_pode_checar","check":null,"using":"(auth.role() = ''authenticated''::text)","papeis":["public"],"tabela":"admins","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"admin_atualiza_qualquer_registro","check":null,"using":"(admin_tem_permissao(''aprovar_cadastros''::text) AND ((auth.jwt() ->> ''aal''::text) = ''aal2''::text))","papeis":["public"],"tabela":"clientes","comando":"UPDATE","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"admin_ve_todos_os_registros","check":null,"using":"(admin_tem_permissao(''aprovar_cadastros''::text) AND ((auth.jwt() ->> ''aal''::text) = ''aal2''::text))","papeis":["public"],"tabela":"clientes","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"cliente_ve_proprio_registro","check":null,"using":"(auth.uid() = id)","papeis":["public"],"tabela":"clientes","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"clientes_insert_proprio","check":"(auth.uid() = id)","using":null,"papeis":["public"],"tabela":"clientes","comando":"INSERT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"clientes_select_proprio","check":null,"using":"(auth.uid() = id)","papeis":["public"],"tabela":"clientes","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"clientes_update_proprio","check":null,"using":"(auth.uid() = id)","papeis":["public"],"tabela":"clientes","comando":"UPDATE","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_agenda_da_empresa","check":"pode_acessar_empresa_operacao(organizacao_id, empresa_id)","using":"pode_acessar_empresa_operacao(organizacao_id, empresa_id)","papeis":["public"],"tabela":"operacao_agenda","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_anexos_da_empresa","check":"(pode_acessar_processo_operacao(organizacao_id, processo_id) AND acesso_arquivo_operacao(arquivo_caminho))","using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["public"],"tabela":"operacao_anexos_processo","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_contratos_da_empresa","check":"pode_acessar_processo_operacao(organizacao_id, processo_id)","using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["public"],"tabela":"operacao_contratos","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_documentos_da_empresa","check":"pode_acessar_empresa_operacao(organizacao_id, empresa_id)","using":"pode_acessar_empresa_operacao(organizacao_id, empresa_id)","papeis":["public"],"tabela":"operacao_documentos","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_empenhos_da_empresa","check":"pode_acessar_processo_operacao(organizacao_id, processo_id)","using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["public"],"tabela":"operacao_empenhos","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_empresas_escrita","check":"eh_membro_operacao(organizacao_id)","using":"eh_membro_operacao(organizacao_id)","papeis":["public"],"tabela":"operacao_empresas","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_empresas_leitura","check":null,"using":"pode_acessar_empresa_operacao(organizacao_id, id)","papeis":["public"],"tabela":"operacao_empresas","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_itens_da_empresa","check":"pode_acessar_processo_operacao(organizacao_id, processo_id)","using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["public"],"tabela":"operacao_itens_resultado","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_membros_da_org","check":null,"using":"((usuario_id = auth.uid()) OR eh_membro_operacao(organizacao_id))","papeis":["public"],"tabela":"operacao_membros","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_ocorrencias_da_empresa","check":"pode_acessar_processo_operacao(organizacao_id, processo_id)","using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["public"],"tabela":"operacao_ocorrencias","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_organizacoes_proprias","check":null,"using":"tem_vinculo_operacao(id)","papeis":["public"],"tabela":"operacao_organizacoes","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_prazos_da_empresa","check":"pode_acessar_processo_operacao(organizacao_id, processo_id)","using":"pode_acessar_processo_operacao(organizacao_id, processo_id)","papeis":["public"],"tabela":"operacao_prazos_processo","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_processos_da_empresa","check":"pode_acessar_empresa_operacao(organizacao_id, empresa_id)","using":"pode_acessar_empresa_operacao(organizacao_id, empresa_id)","papeis":["public"],"tabela":"operacao_processos","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_renovacoes_da_empresa","check":"(EXISTS ( SELECT 1\n   FROM operacao_documentos d\n  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND pode_acessar_empresa_operacao(d.organizacao_id, d.empresa_id))))","using":"(EXISTS ( SELECT 1\n   FROM operacao_documentos d\n  WHERE ((d.id = operacao_renovacoes_documento.documento_id) AND pode_acessar_empresa_operacao(d.organizacao_id, d.empresa_id))))","papeis":["public"],"tabela":"operacao_renovacoes_documento","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_tipos_escrita","check":"((organizacao_id IS NOT NULL) AND eh_membro_operacao(organizacao_id))","using":"((organizacao_id IS NOT NULL) AND eh_membro_operacao(organizacao_id))","papeis":["public"],"tabela":"operacao_tipos_documento","comando":"ALL","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_tipos_leitura","check":null,"using":"((organizacao_id IS NULL) OR eh_membro_operacao(organizacao_id))","papeis":["public"],"tabela":"operacao_tipos_documento","comando":"SELECT","esquema":"public","permissiva":"PERMISSIVE"},{"nome":"operacao_arquivos_atualizacao","check":"((bucket_id = ''operacao-documentos''::text) AND acesso_arquivo_operacao(name))","using":"((bucket_id = ''operacao-documentos''::text) AND acesso_arquivo_operacao(name))","papeis":["public"],"tabela":"objects","comando":"UPDATE","esquema":"storage","permissiva":"PERMISSIVE"},{"nome":"operacao_arquivos_envio","check":"((bucket_id = ''operacao-documentos''::text) AND acesso_arquivo_operacao(name))","using":null,"papeis":["public"],"tabela":"objects","comando":"INSERT","esquema":"storage","permissiva":"PERMISSIVE"},{"nome":"operacao_arquivos_exclusao","check":null,"using":"((bucket_id = ''operacao-documentos''::text) AND acesso_arquivo_operacao(name))","papeis":["public"],"tabela":"objects","comando":"DELETE","esquema":"storage","permissiva":"PERMISSIVE"},{"nome":"operacao_arquivos_leitura","check":null,"using":"((bucket_id = ''operacao-documentos''::text) AND acesso_arquivo_operacao(name))","papeis":["public"],"tabela":"objects","comando":"SELECT","esquema":"storage","permissiva":"PERMISSIVE"},{"nome":"dados_robo_select_authenticated","check":null,"using":"(auth.role() = ''authenticated''::text)","papeis":["public"],"comando":"SELECT","permissiva":"PERMISSIVE","esquema":"public","tabela":"dados_robo"},{"nome":"dados_robo_write_admin","check":"((auth.jwt() ->> ''email''::text) IN ( SELECT admins.email\n   FROM admins))","using":"((auth.jwt() ->> ''email''::text) IN ( SELECT admins.email\n   FROM admins))","papeis":["public"],"comando":"ALL","permissiva":"PERMISSIVE","esquema":"public","tabela":"dados_robo"}],"triggers":[{"nome":"enforce_bucket_name_length_trigger","funcao":"storage.enforce_bucket_name_length()","tabela":"buckets","esquema":"storage","definicao":"CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length()","habilitado":"O"},{"nome":"protect_bucket_control_insert","funcao":"storage.protect_bucket_control_columns()","tabela":"buckets","esquema":"storage","definicao":"CREATE TRIGGER protect_bucket_control_insert BEFORE INSERT ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns(''service_role'')","habilitado":"O"},{"nome":"protect_bucket_control_update","funcao":"storage.protect_bucket_control_columns()","tabela":"buckets","esquema":"storage","definicao":"CREATE TRIGGER protect_bucket_control_update BEFORE UPDATE OF lifecycle_configuration, lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns()","habilitado":"O"},{"nome":"protect_bucket_control_update_role","funcao":"storage.enforce_bucket_lifecycle_service_role()","tabela":"buckets","esquema":"storage","definicao":"CREATE TRIGGER protect_bucket_control_update_role AFTER UPDATE OF lifecycle_configuration, lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_lifecycle_service_role(''service_role'')","habilitado":"O"},{"nome":"protect_buckets_delete","funcao":"storage.protect_delete()","tabela":"buckets","esquema":"storage","definicao":"CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete()","habilitado":"O"},{"nome":"protect_objects_delete","funcao":"storage.protect_delete()","tabela":"objects","esquema":"storage","definicao":"CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete()","habilitado":"O"},{"nome":"update_objects_updated_at","funcao":"storage.update_updated_at_column()","tabela":"objects","esquema":"storage","definicao":"CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column()","habilitado":"O"},{"nome":"on_auth_user_created","funcao":"criar_cliente_no_cadastro()","tabela":"users","esquema":"auth","definicao":"CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION criar_cliente_no_cadastro()","habilitado":"O"},{"nome":"proteger_status_cliente_operacao","funcao":"proteger_status_cliente_operacao()","tabela":"clientes","esquema":"public","definicao":"CREATE TRIGGER proteger_status_cliente_operacao BEFORE INSERT OR UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION proteger_status_cliente_operacao()","habilitado":"O"},{"nome":"operacao_empresas_limite_cnpjs","funcao":"verificar_limite_cnpjs_operacao()","tabela":"operacao_empresas","esquema":"public","definicao":"CREATE TRIGGER operacao_empresas_limite_cnpjs BEFORE INSERT OR UPDATE OF ativo, organizacao_id ON operacao_empresas FOR EACH ROW EXECUTE FUNCTION verificar_limite_cnpjs_operacao()","habilitado":"O"}],"acl_relacoes":[{"papel":"postgres","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"SELECT","grant_option":true},{"papel":"postgres","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"UPDATE","grant_option":false},{"papel":"supabase_auth_admin","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"DELETE","grant_option":false},{"papel":"supabase_auth_admin","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"INSERT","grant_option":false},{"papel":"supabase_auth_admin","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"MAINTAIN","grant_option":false},{"papel":"supabase_auth_admin","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"REFERENCES","grant_option":false},{"papel":"supabase_auth_admin","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"SELECT","grant_option":false},{"papel":"supabase_auth_admin","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"TRIGGER","grant_option":false},{"papel":"supabase_auth_admin","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"TRUNCATE","grant_option":false},{"papel":"supabase_auth_admin","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"UPDATE","grant_option":false},{"papel":"dashboard_user","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"DELETE","grant_option":false},{"papel":"dashboard_user","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"INSERT","grant_option":false},{"papel":"dashboard_user","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"MAINTAIN","grant_option":false},{"papel":"dashboard_user","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"REFERENCES","grant_option":false},{"papel":"dashboard_user","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"SELECT","grant_option":false},{"papel":"dashboard_user","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"TRIGGER","grant_option":false},{"papel":"dashboard_user","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"TRUNCATE","grant_option":false},{"papel":"dashboard_user","objeto":"users","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"DELETE","grant_option":true},{"papel":"postgres","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"INSERT","grant_option":true},{"papel":"postgres","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"MAINTAIN","grant_option":true},{"papel":"postgres","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"REFERENCES","grant_option":true},{"papel":"postgres","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"SELECT","grant_option":true},{"papel":"postgres","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"TRIGGER","grant_option":true},{"papel":"postgres","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"TRUNCATE","grant_option":true},{"papel":"postgres","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"UPDATE","grant_option":true},{"papel":"anon","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"UPDATE","grant_option":false},{"papel":"supabase_storage_admin","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"DELETE","grant_option":true},{"papel":"supabase_storage_admin","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"INSERT","grant_option":true},{"papel":"supabase_storage_admin","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"MAINTAIN","grant_option":true},{"papel":"supabase_storage_admin","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"REFERENCES","grant_option":true},{"papel":"supabase_storage_admin","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"SELECT","grant_option":true},{"papel":"supabase_storage_admin","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"TRIGGER","grant_option":true},{"papel":"supabase_storage_admin","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"TRUNCATE","grant_option":true},{"papel":"supabase_storage_admin","objeto":"buckets","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"UPDATE","grant_option":true},{"papel":"postgres","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"DELETE","grant_option":true},{"papel":"postgres","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"INSERT","grant_option":true},{"papel":"postgres","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"MAINTAIN","grant_option":true},{"papel":"postgres","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"REFERENCES","grant_option":true},{"papel":"postgres","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"SELECT","grant_option":true},{"papel":"postgres","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"TRIGGER","grant_option":true},{"papel":"postgres","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"TRUNCATE","grant_option":true},{"papel":"postgres","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"UPDATE","grant_option":true},{"papel":"anon","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"UPDATE","grant_option":false},{"papel":"supabase_storage_admin","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"DELETE","grant_option":true},{"papel":"supabase_storage_admin","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"INSERT","grant_option":true},{"papel":"supabase_storage_admin","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"MAINTAIN","grant_option":true},{"papel":"supabase_storage_admin","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"REFERENCES","grant_option":true},{"papel":"supabase_storage_admin","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"SELECT","grant_option":true},{"papel":"supabase_storage_admin","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"TRIGGER","grant_option":true},{"papel":"supabase_storage_admin","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"TRUNCATE","grant_option":true},{"papel":"supabase_storage_admin","objeto":"objects","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"UPDATE","grant_option":true},{"papel":"postgres","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"admins","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"clientes","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_agenda","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_anexos_processo","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_contratos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_convites_empresa","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_documentos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_empenhos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_empresas","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_itens_resultado","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_limites_cnpj","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_membros","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_ocorrencias","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_organizacoes","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_prazos_processo","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_processos","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_renovacoes_documento","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"postgres","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"postgres","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"postgres","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"postgres","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"postgres","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"postgres","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"postgres","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"anon","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"anon","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"anon","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"anon","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"anon","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"anon","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"anon","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"anon","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"authenticated","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"authenticated","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"authenticated","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"authenticated","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"authenticated","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"authenticated","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"authenticated","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"service_role","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"DELETE","grant_option":false},{"papel":"service_role","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"INSERT","grant_option":false},{"papel":"service_role","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false},{"papel":"service_role","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"REFERENCES","grant_option":false},{"papel":"service_role","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"SELECT","grant_option":false},{"papel":"service_role","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"TRIGGER","grant_option":false},{"papel":"service_role","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false},{"papel":"service_role","objeto":"operacao_tipos_documento","esquema":"public","concedente":"postgres","privilegio":"UPDATE","grant_option":false},{"papel":"postgres","concedente":"postgres","privilegio":"DELETE","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"postgres","concedente":"postgres","privilegio":"INSERT","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"postgres","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"postgres","concedente":"postgres","privilegio":"REFERENCES","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"postgres","concedente":"postgres","privilegio":"SELECT","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"postgres","concedente":"postgres","privilegio":"TRIGGER","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"postgres","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"postgres","concedente":"postgres","privilegio":"UPDATE","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"anon","concedente":"postgres","privilegio":"DELETE","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"anon","concedente":"postgres","privilegio":"INSERT","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"anon","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"anon","concedente":"postgres","privilegio":"REFERENCES","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"anon","concedente":"postgres","privilegio":"SELECT","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"anon","concedente":"postgres","privilegio":"TRIGGER","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"anon","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"anon","concedente":"postgres","privilegio":"UPDATE","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"authenticated","concedente":"postgres","privilegio":"DELETE","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"authenticated","concedente":"postgres","privilegio":"INSERT","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"authenticated","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"authenticated","concedente":"postgres","privilegio":"REFERENCES","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"authenticated","concedente":"postgres","privilegio":"SELECT","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"authenticated","concedente":"postgres","privilegio":"TRIGGER","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"authenticated","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"authenticated","concedente":"postgres","privilegio":"UPDATE","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"service_role","concedente":"postgres","privilegio":"DELETE","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"service_role","concedente":"postgres","privilegio":"INSERT","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"service_role","concedente":"postgres","privilegio":"MAINTAIN","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"service_role","concedente":"postgres","privilegio":"REFERENCES","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"service_role","concedente":"postgres","privilegio":"SELECT","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"service_role","concedente":"postgres","privilegio":"TRIGGER","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"service_role","concedente":"postgres","privilegio":"TRUNCATE","grant_option":false,"esquema":"public","objeto":"dados_robo"},{"papel":"service_role","concedente":"postgres","privilegio":"UPDATE","grant_option":false,"esquema":"public","objeto":"dados_robo"}],"acl_funcoes":[{"papel":"PUBLIC","objeto":"auth.uid()","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"EXECUTE","grant_option":false},{"papel":"supabase_auth_admin","objeto":"auth.uid()","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"EXECUTE","grant_option":false},{"papel":"dashboard_user","objeto":"auth.uid()","esquema":"auth","concedente":"supabase_auth_admin","privilegio":"EXECUTE","grant_option":false},{"papel":"PUBLIC","objeto":"storage.enforce_bucket_lifecycle_service_role()","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"EXECUTE","grant_option":false},{"papel":"supabase_storage_admin","objeto":"storage.enforce_bucket_lifecycle_service_role()","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"EXECUTE","grant_option":false},{"papel":"PUBLIC","objeto":"storage.enforce_bucket_name_length()","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"EXECUTE","grant_option":false},{"papel":"supabase_storage_admin","objeto":"storage.enforce_bucket_name_length()","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"EXECUTE","grant_option":false},{"papel":"PUBLIC","objeto":"storage.protect_bucket_control_columns()","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"EXECUTE","grant_option":false},{"papel":"supabase_storage_admin","objeto":"storage.protect_bucket_control_columns()","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"EXECUTE","grant_option":false},{"papel":"PUBLIC","objeto":"storage.protect_delete()","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"EXECUTE","grant_option":false},{"papel":"supabase_storage_admin","objeto":"storage.protect_delete()","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"EXECUTE","grant_option":false},{"papel":"PUBLIC","objeto":"storage.update_updated_at_column()","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"EXECUTE","grant_option":false},{"papel":"supabase_storage_admin","objeto":"storage.update_updated_at_column()","esquema":"storage","concedente":"supabase_storage_admin","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"aceitar_convite_empresa_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"aceitar_convite_empresa_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"aceitar_convite_empresa_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"acesso_arquivo_operacao(text)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"acesso_arquivo_operacao(text)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"acesso_arquivo_operacao(text)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"PUBLIC","objeto":"bootstrap_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"bootstrap_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"anon","objeto":"bootstrap_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"bootstrap_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"bootstrap_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"configurar_limite_cnpjs_cliente(uuid,integer)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"configurar_limite_cnpjs_cliente(uuid,integer)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"configurar_limite_cnpjs_cliente(uuid,integer)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"consultar_limite_cnpjs_cliente(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"consultar_limite_cnpjs_cliente(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"consultar_limite_cnpjs_cliente(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"criar_convite_empresa_operacao(uuid,text,text)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"criar_convite_empresa_operacao(uuid,text,text)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"criar_convite_empresa_operacao(uuid,text,text)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"PUBLIC","objeto":"eh_membro_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"eh_membro_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"anon","objeto":"eh_membro_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"eh_membro_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"eh_membro_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"eh_owner_admin_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"eh_owner_admin_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"limite_cnpjs_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"limite_cnpjs_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"limite_cnpjs_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"listar_acessos_empresa_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"listar_acessos_empresa_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"listar_acessos_empresa_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"listar_convites_empresa_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"listar_convites_empresa_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"listar_convites_empresa_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"listar_empresas_convite_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"listar_empresas_convite_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"listar_empresas_convite_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"meu_acesso_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"meu_acesso_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"meu_acesso_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"pode_acessar_empresa_operacao(uuid,uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"pode_acessar_empresa_operacao(uuid,uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"pode_acessar_empresa_operacao(uuid,uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"pode_acessar_processo_operacao(uuid,uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"pode_acessar_processo_operacao(uuid,uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"pode_acessar_processo_operacao(uuid,uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"PUBLIC","objeto":"proteger_status_cliente_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"proteger_status_cliente_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"anon","objeto":"proteger_status_cliente_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"proteger_status_cliente_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"proteger_status_cliente_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"revogar_acesso_empresa_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"revogar_acesso_empresa_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"revogar_acesso_empresa_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"revogar_convite_empresa_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"revogar_convite_empresa_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"revogar_convite_empresa_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"tem_vinculo_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"tem_vinculo_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"tem_vinculo_operacao(uuid)","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"PUBLIC","objeto":"verificar_limite_cnpjs_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"postgres","objeto":"verificar_limite_cnpjs_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"anon","objeto":"verificar_limite_cnpjs_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"authenticated","objeto":"verificar_limite_cnpjs_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"service_role","objeto":"verificar_limite_cnpjs_operacao()","esquema":"public","concedente":"postgres","privilegio":"EXECUTE","grant_option":false},{"papel":"PUBLIC","concedente":"postgres","privilegio":"EXECUTE","grant_option":false,"esquema":"public","objeto":"admin_tem_permissao(text)"},{"papel":"anon","concedente":"postgres","privilegio":"EXECUTE","grant_option":false,"esquema":"public","objeto":"admin_tem_permissao(text)"},{"papel":"authenticated","concedente":"postgres","privilegio":"EXECUTE","grant_option":false,"esquema":"public","objeto":"admin_tem_permissao(text)"},{"papel":"postgres","concedente":"postgres","privilegio":"EXECUTE","grant_option":false,"esquema":"public","objeto":"admin_tem_permissao(text)"},{"papel":"service_role","concedente":"postgres","privilegio":"EXECUTE","grant_option":false,"esquema":"public","objeto":"admin_tem_permissao(text)"},{"papel":"PUBLIC","concedente":"postgres","privilegio":"EXECUTE","grant_option":false,"esquema":"public","objeto":"criar_cliente_no_cadastro()"},{"papel":"anon","concedente":"postgres","privilegio":"EXECUTE","grant_option":false,"esquema":"public","objeto":"criar_cliente_no_cadastro()"},{"papel":"authenticated","concedente":"postgres","privilegio":"EXECUTE","grant_option":false,"esquema":"public","objeto":"criar_cliente_no_cadastro()"},{"papel":"postgres","concedente":"postgres","privilegio":"EXECUTE","grant_option":false,"esquema":"public","objeto":"criar_cliente_no_cadastro()"},{"papel":"service_role","concedente":"postgres","privilegio":"EXECUTE","grant_option":false,"esquema":"public","objeto":"criar_cliente_no_cadastro()"}],"defaults_acl":[{"acl":"{postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}","dono":"supabase_admin","tipo":"S","esquema":"public"},{"acl":"{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}","dono":"supabase_admin","tipo":"f","esquema":"public"},{"acl":"{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}","dono":"supabase_admin","tipo":"r","esquema":"public"},{"acl":"{postgres=rwU/postgres}","dono":"postgres","tipo":"S","esquema":"public"},{"acl":"{postgres=X/postgres}","dono":"postgres","tipo":"f","esquema":"public"},{"acl":"{postgres=arwdDxtm/postgres,anon=Dxtm/postgres,authenticated=Dxtm/postgres,service_role=Dxtm/postgres}","dono":"postgres","tipo":"r","esquema":"public"},{"acl":"{postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}","dono":"postgres","tipo":"S","esquema":"storage"},{"acl":"{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}","dono":"postgres","tipo":"f","esquema":"storage"},{"acl":"{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}","dono":"postgres","tipo":"r","esquema":"storage"},{"acl":"{postgres=rwU/supabase_auth_admin,dashboard_user=rwU/supabase_auth_admin}","dono":"supabase_auth_admin","tipo":"S","esquema":"auth"},{"acl":"{postgres=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin}","dono":"supabase_auth_admin","tipo":"f","esquema":"auth"},{"acl":"{postgres=arwdDxtm/supabase_auth_admin,dashboard_user=arwdDxtm/supabase_auth_admin}","dono":"supabase_auth_admin","tipo":"r","esquema":"auth"}],"papeis":[{"nome":"anon","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"authenticated","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"authenticator","login":true,"inherit":false,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"dashboard_user","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":true},{"nome":"pg_checkpoint","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"pg_create_subscription","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"pg_database_owner","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"pg_execute_server_program","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"pg_maintain","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"pg_monitor","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"pg_read_all_data","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"pg_read_all_settings","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"pg_read_all_stats","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"pg_read_server_files","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"pg_signal_backend","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"pg_stat_scan_tables","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"pg_use_reserved_connections","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"pg_write_all_data","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"pg_write_server_files","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"pgbouncer","login":true,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"postgres","login":true,"inherit":true,"superuser":false,"bypass_rls":true,"create_role":true},{"nome":"service_role","login":false,"inherit":true,"superuser":false,"bypass_rls":true,"create_role":false},{"nome":"supabase_admin","login":true,"inherit":true,"superuser":true,"bypass_rls":true,"create_role":true},{"nome":"supabase_auth_admin","login":true,"inherit":false,"superuser":false,"bypass_rls":false,"create_role":true},{"nome":"supabase_etl_admin","login":true,"inherit":true,"superuser":false,"bypass_rls":true,"create_role":false},{"nome":"supabase_privileged_role","login":false,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"supabase_read_only_user","login":true,"inherit":true,"superuser":false,"bypass_rls":true,"create_role":false},{"nome":"supabase_realtime_admin","login":false,"inherit":false,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"supabase_replication_admin","login":true,"inherit":true,"superuser":false,"bypass_rls":false,"create_role":false},{"nome":"supabase_storage_admin","login":true,"inherit":false,"superuser":false,"bypass_rls":false,"create_role":true}],"membros_papeis":[{"papel":"pg_monitor","membro":"postgres","concedente":"supabase_admin","set_option":true,"admin_option":true,"inherit_option":true},{"papel":"pg_monitor","membro":"supabase_etl_admin","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":true},{"papel":"pg_monitor","membro":"supabase_read_only_user","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":true},{"papel":"pg_read_all_settings","membro":"pg_monitor","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":true},{"papel":"pg_read_all_stats","membro":"pg_monitor","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":true},{"papel":"pg_stat_scan_tables","membro":"pg_monitor","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":true},{"papel":"pg_signal_backend","membro":"postgres","concedente":"supabase_admin","set_option":true,"admin_option":true,"inherit_option":true},{"papel":"pg_read_all_data","membro":"postgres","concedente":"supabase_admin","set_option":true,"admin_option":true,"inherit_option":true},{"papel":"pg_read_all_data","membro":"supabase_etl_admin","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":true},{"papel":"pg_read_all_data","membro":"supabase_read_only_user","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":true},{"papel":"pg_create_subscription","membro":"postgres","concedente":"supabase_admin","set_option":true,"admin_option":true,"inherit_option":true},{"papel":"anon","membro":"postgres","concedente":"supabase_admin","set_option":true,"admin_option":true,"inherit_option":true},{"papel":"anon","membro":"authenticator","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":false},{"papel":"anon","membro":"supabase_realtime_admin","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":false},{"papel":"authenticated","membro":"postgres","concedente":"supabase_admin","set_option":true,"admin_option":true,"inherit_option":true},{"papel":"authenticated","membro":"authenticator","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":false},{"papel":"authenticated","membro":"supabase_realtime_admin","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":false},{"papel":"service_role","membro":"postgres","concedente":"supabase_admin","set_option":true,"admin_option":true,"inherit_option":true},{"papel":"service_role","membro":"authenticator","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":false},{"papel":"service_role","membro":"supabase_realtime_admin","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":false},{"papel":"authenticator","membro":"postgres","concedente":"supabase_admin","set_option":true,"admin_option":true,"inherit_option":true},{"papel":"authenticator","membro":"supabase_storage_admin","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":false},{"papel":"supabase_privileged_role","membro":"postgres","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":true},{"papel":"supabase_privileged_role","membro":"supabase_etl_admin","concedente":"supabase_admin","set_option":true,"admin_option":false,"inherit_option":true}],"schemas":[{"acl":"{supabase_admin=UC/supabase_admin,anon=U/supabase_admin,authenticated=U/supabase_admin,service_role=U/supabase_admin,supabase_auth_admin=UC/supabase_admin,dashboard_user=UC/supabase_admin,postgres=U/supabase_admin}","dono":"supabase_admin","nome":"auth"},{"acl":"{pg_database_owner=UC/pg_database_owner,=U/pg_database_owner,postgres=U/pg_database_owner,anon=U/pg_database_owner,authenticated=U/pg_database_owner,service_role=U/pg_database_owner}","dono":"pg_database_owner","nome":"public"},{"acl":"{supabase_admin=UC/supabase_admin,postgres=U*/supabase_admin,anon=U/supabase_admin,authenticated=U/supabase_admin,service_role=U/supabase_admin,supabase_storage_admin=U*C*/supabase_admin,dashboard_user=UC/supabase_admin}","dono":"supabase_admin","nome":"storage"}],"relacoes":[{"rls":true,"dono":"supabase_auth_admin","nome":"users","tipo":"r","opcoes":null,"esquema":"auth","force_rls":false},{"rls":true,"dono":"supabase_storage_admin","nome":"buckets","tipo":"r","opcoes":null,"esquema":"storage","force_rls":false},{"rls":true,"dono":"supabase_storage_admin","nome":"objects","tipo":"r","opcoes":null,"esquema":"storage","force_rls":false},{"rls":true,"dono":"postgres","nome":"admins","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"clientes","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_agenda","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_anexos_processo","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_contratos","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_convites_empresa","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_documentos","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_empenhos","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_empresas","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_itens_resultado","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_limites_cnpj","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_membros","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_ocorrencias","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_organizacoes","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_prazos_processo","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_processos","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_renovacoes_documento","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"operacao_tipos_documento","tipo":"r","opcoes":null,"esquema":"public","force_rls":false},{"rls":true,"dono":"postgres","nome":"dados_robo","tipo":"r","esquema":"public","force_rls":false,"opcoes":null}],"funcoes":[{"esquema":"auth","assinatura":"auth.uid()","dono":"supabase_auth_admin","retorno":"uuid","security_definer":false,"strict":false,"volatilidade":"s","configuracao":null,"hash_corpo_md5":"cdef18c69c4f4cbbced2eaf81e628b49"},{"esquema":"storage","assinatura":"storage.enforce_bucket_lifecycle_service_role()","dono":"supabase_storage_admin","retorno":"trigger","security_definer":false,"strict":false,"volatilidade":"v","configuracao":["search_path=pg_catalog"],"hash_corpo_md5":"7691066f4111610b457b74bdead6e80b"},{"esquema":"storage","assinatura":"storage.enforce_bucket_name_length()","dono":"supabase_storage_admin","retorno":"trigger","security_definer":false,"strict":false,"volatilidade":"v","configuracao":null,"hash_corpo_md5":"bd3d77a2603f7f344035a81def5502fa"},{"esquema":"storage","assinatura":"storage.protect_bucket_control_columns()","dono":"supabase_storage_admin","retorno":"trigger","security_definer":false,"strict":false,"volatilidade":"v","configuracao":["search_path=pg_catalog"],"hash_corpo_md5":"7870415452678f5aa85f91dde952ef12"},{"esquema":"storage","assinatura":"storage.protect_delete()","dono":"supabase_storage_admin","retorno":"trigger","security_definer":false,"strict":false,"volatilidade":"v","configuracao":null,"hash_corpo_md5":"998d324ea2b1abc49351e8c2367b5796"},{"esquema":"storage","assinatura":"storage.update_updated_at_column()","dono":"supabase_storage_admin","retorno":"trigger","security_definer":false,"strict":false,"volatilidade":"v","configuracao":null,"hash_corpo_md5":"7596e66a7698d5a6b5129c5ce9b24c5f"},{"esquema":"public","assinatura":"admin_tem_permissao(text)","dono":"postgres","retorno":"boolean","security_definer":true,"strict":false,"volatilidade":"s","configuracao":["search_path=public"],"hash_corpo_md5":"6d9e404c46ad1324e53d9e6d96994a49"},{"esquema":"public","assinatura":"eh_membro_operacao(uuid)","dono":"postgres","retorno":"boolean","security_definer":true,"strict":false,"volatilidade":"s","configuracao":["search_path=public"],"hash_corpo_md5":"9b6233397bacd8969cffb78b72441aa1"},{"esquema":"public","assinatura":"tem_vinculo_operacao(uuid)","dono":"postgres","retorno":"boolean","security_definer":true,"strict":false,"volatilidade":"s","configuracao":["search_path=public"],"hash_corpo_md5":"bd56a292af6713a18b57c7b2dfeabb30"},{"esquema":"public","assinatura":"pode_acessar_empresa_operacao(uuid,uuid)","dono":"postgres","retorno":"boolean","security_definer":true,"strict":false,"volatilidade":"s","configuracao":["search_path=public"],"hash_corpo_md5":"a65652b6399787006cfa28ef096d18a8"},{"esquema":"public","assinatura":"pode_acessar_processo_operacao(uuid,uuid)","dono":"postgres","retorno":"boolean","security_definer":true,"strict":false,"volatilidade":"s","configuracao":["search_path=public"],"hash_corpo_md5":"a59cc3c215090363db971260e1b42fba"},{"esquema":"public","assinatura":"acesso_arquivo_operacao(text)","dono":"postgres","retorno":"boolean","security_definer":true,"strict":false,"volatilidade":"s","configuracao":["search_path=public"],"hash_corpo_md5":"e8b6d5aeab225aa40f915a123b40b5eb"},{"esquema":"public","assinatura":"eh_owner_admin_operacao(uuid)","dono":"postgres","retorno":"boolean","security_definer":true,"strict":false,"volatilidade":"s","configuracao":["search_path=public"],"hash_corpo_md5":"11f8595ce15d3518649fbb5e0db4bff5"},{"esquema":"public","assinatura":"limite_cnpjs_operacao()","dono":"postgres","retorno":"integer","security_definer":true,"strict":false,"volatilidade":"s","configuracao":["search_path=public"],"hash_corpo_md5":"4ccb57c6f34c2661cb90ba3bfb0b7b3b"},{"esquema":"public","assinatura":"aceitar_convite_empresa_operacao(uuid)","dono":"postgres","retorno":"jsonb","security_definer":true,"strict":false,"volatilidade":"v","configuracao":["search_path=public"],"hash_corpo_md5":"28e7227da81805d0937daf7b996ba8de"},{"esquema":"public","assinatura":"bootstrap_operacao()","dono":"postgres","retorno":"uuid","security_definer":true,"strict":false,"volatilidade":"v","configuracao":["search_path=public"],"hash_corpo_md5":"153698541bb8b7078c251263b456ccf0"},{"esquema":"public","assinatura":"configurar_limite_cnpjs_cliente(uuid,integer)","dono":"postgres","retorno":"integer","security_definer":true,"strict":false,"volatilidade":"v","configuracao":["search_path=public"],"hash_corpo_md5":"f64b5509718d19ff7807262c90e54aa3"},{"esquema":"public","assinatura":"consultar_limite_cnpjs_cliente(uuid)","dono":"postgres","retorno":"integer","security_definer":true,"strict":false,"volatilidade":"s","configuracao":["search_path=public"],"hash_corpo_md5":"8e74a3f072c51475f3986dc1b4de372c"},{"esquema":"public","assinatura":"criar_convite_empresa_operacao(uuid,text,text)","dono":"postgres","retorno":"jsonb","security_definer":true,"strict":false,"volatilidade":"v","configuracao":["search_path=public"],"hash_corpo_md5":"27bf95490029116f0766cfc7f51e442d"},{"esquema":"public","assinatura":"listar_acessos_empresa_operacao()","dono":"postgres","retorno":"TABLE(usuario_id uuid, email text, nome text, empresa text, empresa_id uuid)","security_definer":true,"strict":false,"volatilidade":"s","configuracao":["search_path=public"],"hash_corpo_md5":"68cd840659edbe6561530a2e8b28746d"},{"esquema":"public","assinatura":"listar_convites_empresa_operacao()","dono":"postgres","retorno":"TABLE(id uuid, email text, nome text, empresa text, expira_em timestamp with time zone, aceito_em timestamp with time zone, revogado_em timestamp with time zone)","security_definer":true,"strict":false,"volatilidade":"s","configuracao":["search_path=public"],"hash_corpo_md5":"c5c91d964d8507bb789d1db970b0a2eb"},{"esquema":"public","assinatura":"listar_empresas_convite_operacao()","dono":"postgres","retorno":"TABLE(id uuid, razao_social text, cnpj text)","security_definer":true,"strict":false,"volatilidade":"s","configuracao":["search_path=public"],"hash_corpo_md5":"eda8d7f1598d2cd33ea46714632b517d"},{"esquema":"public","assinatura":"meu_acesso_operacao()","dono":"postgres","retorno":"jsonb","security_definer":true,"strict":false,"volatilidade":"s","configuracao":["search_path=public"],"hash_corpo_md5":"58b26e389c4072e9646433f4df6488fc"},{"esquema":"public","assinatura":"proteger_status_cliente_operacao()","dono":"postgres","retorno":"trigger","security_definer":true,"strict":false,"volatilidade":"v","configuracao":["search_path=public"],"hash_corpo_md5":"6cc585a284f297b7ac5e6c18c11858fd"},{"esquema":"public","assinatura":"revogar_acesso_empresa_operacao(uuid)","dono":"postgres","retorno":"boolean","security_definer":true,"strict":false,"volatilidade":"v","configuracao":["search_path=public"],"hash_corpo_md5":"e336ae12b065bcb4b0ef5ee5c4872011"},{"esquema":"public","assinatura":"revogar_convite_empresa_operacao(uuid)","dono":"postgres","retorno":"boolean","security_definer":true,"strict":false,"volatilidade":"v","configuracao":["search_path=public"],"hash_corpo_md5":"7a4b4ad1981963137d55018b69364547"},{"esquema":"public","assinatura":"verificar_limite_cnpjs_operacao()","dono":"postgres","retorno":"trigger","security_definer":true,"strict":false,"volatilidade":"v","configuracao":["search_path=public"],"hash_corpo_md5":"b09933ca5382b9e30b6b9e85f82532a4"},{"esquema":"public","assinatura":"criar_cliente_no_cadastro()","dono":"postgres","retorno":"trigger","security_definer":true,"strict":false,"volatilidade":"v","configuracao":["search_path=public"],"hash_corpo_md5":"32a21d12de6a3a909de316bb2c2f04a8"}]}'::jsonb;
begin
 with
relacoes as (
 select c.*,n.nspname as esquema from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p','v','m','f','S') and ((n.nspname='public' and (c.relname like 'operacao\_%' escape '\' or c.relname in ('clientes','admins','dados_robo')))
    or (n.nspname='auth' and c.relname='users')
    or (n.nspname='storage' and c.relname in ('objects','buckets')))
), funcoes as (
 select p.*,n.nspname as esquema from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.prokind in ('f','p') and (
  (n.nspname='public' and (p.proname like '%operacao%' or p.proname like '%identificacao_empresa%' or p.proname in ('gravar_kit_documento','kit_documento_escopo_imutavel','configurar_limite_cnpjs_cliente','consultar_limite_cnpjs_cliente','admin_tem_permissao')))
  or (n.nspname='auth' and p.proname='uid')
  or p.oid in (select t.tgfoid from pg_trigger t join relacoes r on r.oid=t.tgrelid where not t.tgisinternal)
 )
), secoes as (
 select 'relacoes' as secao,coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'nome',r.relname,'tipo',r.relkind,'dono',pg_get_userbyid(r.relowner),
  'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity,'opcoes',r.reloptions,
  'acl',r.relacl::text) order by r.esquema,r.relname),'[]'::jsonb) as itens from relacoes r
 union all
 select 'colunas',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'ordem',a.attnum,'nome',a.attname,
  'tipo',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
  'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),
  'acl',a.attacl::text) order by r.esquema,r.relname,a.attnum),'[]'::jsonb)
 from relacoes r join pg_attribute a on a.attrelid=r.oid and a.attnum>0 and not a.attisdropped
 left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where r.relkind in ('r','p','v','m','f')
 union all
 select 'constraints',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',c.conname,'tipo',c.contype,
  'validada',c.convalidated,'deferivel',c.condeferrable,'adiada',c.condeferred,
  'definicao',pg_get_constraintdef(c.oid,true)) order by r.esquema,r.relname,c.conname),'[]'::jsonb)
 from relacoes r join pg_constraint c on c.conrelid=r.oid
 union all
 select 'indices',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',ci.relname,'unico',i.indisunique,
  'valido',i.indisvalid,'pronto',i.indisready,'primario',i.indisprimary,
  'definicao',pg_get_indexdef(i.indexrelid)) order by r.esquema,r.relname,ci.relname),'[]'::jsonb)
 from relacoes r join pg_index i on i.indrelid=r.oid join pg_class ci on ci.oid=i.indexrelid
 union all
 select 'policies',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',schemaname,'tabela',tablename,'nome',policyname,'permissiva',permissive,
  'papeis',roles,'comando',cmd,'using',qual,'check',with_check)
  order by schemaname,tablename,policyname),'[]'::jsonb)
 from pg_policies where (schemaname='public' and (tablename like 'operacao\_%' escape '\' or tablename in ('clientes','admins','dados_robo')))
  or (schemaname='storage' and tablename in ('objects','buckets')) or (schemaname='auth' and tablename='users')
 union all
 select 'triggers',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'tabela',r.relname,'nome',t.tgname,'habilitado',t.tgenabled,
  'funcao',t.tgfoid::regprocedure::text,'definicao',pg_get_triggerdef(t.oid,true))
  order by r.esquema,r.relname,t.tgname),'[]'::jsonb)
 from relacoes r join pg_trigger t on t.tgrelid=r.oid where not t.tgisinternal
 union all
 select 'funcoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',f.esquema,'nome',f.proname,'assinatura',f.oid::regprocedure::text,
  'argumentos',pg_get_function_identity_arguments(f.oid),'retorno',pg_get_function_result(f.oid),
  'dono',pg_get_userbyid(f.proowner),'security_definer',f.prosecdef,'volatilidade',f.provolatile,
  'strict',f.proisstrict,'configuracao',f.proconfig,'acl',f.proacl::text,
  'hash_corpo_md5',md5(replace(f.prosrc,chr(13),'')),
  'definicao',case when f.esquema='public' and (f.proname like '%operacao%' or f.proname like '%identificacao_empresa%' or f.proname in ('gravar_kit_documento','kit_documento_escopo_imutavel','configurar_limite_cnpjs_cliente','consultar_limite_cnpjs_cliente')) then pg_get_functiondef(f.oid) else null end)
  order by f.esquema,f.oid::regprocedure::text),'[]'::jsonb) from funcoes f
 union all
 select 'acl_relacoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',r.esquema,'objeto',r.relname,'concedente',pg_get_userbyid(a.grantor),
  'papel',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilegio',a.privilege_type,'grant_option',a.is_grantable)
  order by r.esquema,r.relname,a.grantee,a.privilege_type),'[]'::jsonb)
 from relacoes r cross join lateral aclexplode(coalesce(r.relacl,acldefault(case when r.relkind='S' then 's'::"char" else 'r'::"char" end,r.relowner))) a
 union all
 select 'acl_funcoes',coalesce(jsonb_agg(jsonb_build_object(
  'esquema',f.esquema,'objeto',f.oid::regprocedure::text,'concedente',pg_get_userbyid(a.grantor),
  'papel',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
  'privilegio',a.privilege_type,'grant_option',a.is_grantable)
  order by f.esquema,f.oid::regprocedure::text,a.grantee,a.privilege_type),'[]'::jsonb)
 from funcoes f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
 union all
 select 'schemas',coalesce(jsonb_agg(jsonb_build_object('nome',nspname,'dono',pg_get_userbyid(nspowner),'acl',nspacl::text) order by nspname),'[]'::jsonb)
 from pg_namespace where nspname in ('public','auth','storage')
 union all
 select 'defaults_acl',coalesce(jsonb_agg(jsonb_build_object('dono',pg_get_userbyid(d.defaclrole),
  'esquema',coalesce(n.nspname,'*'),'tipo',d.defaclobjtype,'acl',d.defaclacl::text)
  order by d.defaclrole,d.defaclnamespace,d.defaclobjtype),'[]'::jsonb)
 from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
 where d.defaclnamespace=0 or n.nspname in ('public','auth','storage')
 union all
 select 'papeis',coalesce(jsonb_agg(jsonb_build_object('nome',rolname,'superuser',rolsuper,
  'inherit',rolinherit,'login',rolcanlogin,'create_role',rolcreaterole,'bypass_rls',rolbypassrls) order by rolname),'[]'::jsonb) from pg_roles
 union all
 select 'membros_papeis',coalesce(jsonb_agg(jsonb_build_object('papel',pg_get_userbyid(m.roleid),
  'membro',pg_get_userbyid(m.member),'concedente',pg_get_userbyid(m.grantor),'admin_option',m.admin_option,
  'inherit_option',to_jsonb(m)->'inherit_option','set_option',to_jsonb(m)->'set_option')
  order by m.roleid,m.member),'[]'::jsonb) from pg_auth_members m
 union all
 select 'dependencias_entrada',coalesce(jsonb_agg(jsonb_build_object(
  'objeto',pg_describe_object(d.classid,d.objid,d.objsubid),
  'referencia',pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid),'tipo',d.deptype)
  order by d.classid,d.objid,d.objsubid,d.refobjid,d.refobjsubid),'[]'::jsonb)
 from pg_depend d where (d.refclassid='pg_class'::regclass and d.refobjid in (select oid from relacoes))
  or (d.refclassid='pg_proc'::regclass and d.refobjid in (select oid from funcoes))
), catalogo as (select jsonb_object_agg(secao,itens order by secao) as corpo from secoes)

 select corpo into observado from catalogo;
 if jsonb_array_length(observado->'colunas')<>272 or not (observado->'colunas') @> (esperado->'colunas') or not (esperado->'colunas') @> (observado->'colunas') then raise exception 'Bootstrap divergente: colunas';end if;
 if jsonb_array_length(observado->'constraints')<>92 or not (observado->'constraints') @> (esperado->'constraints') or not (esperado->'constraints') @> (observado->'constraints') then raise exception 'Bootstrap divergente: constraints';end if;
 if jsonb_array_length(observado->'indices')<>64 or not (observado->'indices') @> (esperado->'indices') or not (esperado->'indices') @> (observado->'indices') then raise exception 'Bootstrap divergente: indices';end if;
 if jsonb_array_length(observado->'policies')<>33 or not (observado->'policies') @> (esperado->'policies') or not (esperado->'policies') @> (observado->'policies') then raise exception 'Bootstrap divergente: policies';end if;
 if jsonb_array_length(observado->'triggers')<>10 or not (observado->'triggers') @> (esperado->'triggers') or not (esperado->'triggers') @> (observado->'triggers') then raise exception 'Bootstrap divergente: triggers';end if;
 if jsonb_array_length(observado->'acl_relacoes')<>664 or not (observado->'acl_relacoes') @> (esperado->'acl_relacoes') or not (esperado->'acl_relacoes') @> (observado->'acl_relacoes') then raise exception 'Bootstrap divergente: acl_relacoes';end if;
 if jsonb_array_length(observado->'acl_funcoes')<>90 or not (observado->'acl_funcoes') @> (esperado->'acl_funcoes') or not (esperado->'acl_funcoes') @> (observado->'acl_funcoes') then raise exception 'Bootstrap divergente: acl_funcoes';end if;
 if jsonb_array_length(observado->'defaults_acl')<>12 or not (observado->'defaults_acl') @> (esperado->'defaults_acl') or not (esperado->'defaults_acl') @> (observado->'defaults_acl') then raise exception 'Bootstrap divergente: defaults_acl';end if;
 if jsonb_array_length(observado->'papeis')<>30 or not (observado->'papeis') @> (esperado->'papeis') or not (esperado->'papeis') @> (observado->'papeis') then raise exception 'Bootstrap divergente: papeis';end if;
 if jsonb_array_length(observado->'membros_papeis')<>24 or not (observado->'membros_papeis') @> (esperado->'membros_papeis') or not (esperado->'membros_papeis') @> (observado->'membros_papeis') then raise exception 'Bootstrap divergente: membros_papeis';end if;
 if jsonb_array_length(observado->'schemas')<>3 or not (observado->'schemas') @> (esperado->'schemas') or not (esperado->'schemas') @> (observado->'schemas') then raise exception 'Bootstrap divergente: schemas';end if;
 select jsonb_agg(x-'acl') into relacoes from jsonb_array_elements(observado->'relacoes') x;
 if jsonb_array_length(relacoes)<>22 or not relacoes @> (esperado->'relacoes') or not (esperado->'relacoes') @> relacoes then raise exception 'Bootstrap divergente: relações/RLS';end if;
 select jsonb_agg(jsonb_build_object('esquema',x->'esquema','assinatura',x->'assinatura','dono',x->'dono','retorno',x->'retorno','security_definer',x->'security_definer','strict',x->'strict','volatilidade',x->'volatilidade','configuracao',x->'configuracao','hash_corpo_md5',x->'hash_corpo_md5')) into funcoes from jsonb_array_elements(observado->'funcoes') x;
 if jsonb_array_length(funcoes)<>28 or not funcoes @> (esperado->'funcoes') or not (esperado->'funcoes') @> funcoes then raise exception 'Bootstrap divergente: funções/corpos';end if;
 for tabela in select unnest(array['admins','clientes','operacao_agenda','operacao_anexos_processo','operacao_contratos','operacao_convites_empresa','operacao_documentos','operacao_empenhos','operacao_empresas','operacao_itens_resultado','operacao_limites_cnpj','operacao_membros','operacao_ocorrencias','operacao_organizacoes','operacao_prazos_processo','operacao_processos','operacao_renovacoes_documento','operacao_tipos_documento','dados_robo']::text[]) loop
  execute format('select exists(select 1 from public.%I)',tabela) into possui_linhas;
  if possui_linhas then raise exception 'Bootstrap deve terminar sem dados em tabelas públicas';end if;
 end loop;
 if exists(select 1 from auth.users) or exists(select 1 from storage.objects) or exists(select 1 from storage.buckets) then raise exception 'Serviços gerenciados receberam dados inesperados';end if;
end
$verificar_bootstrap$;
select 'BOOTSTRAP_PREKIT_STAGING_OK' as resultado;

notify pgrst,'reload schema';
commit;
