export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      acciones_correctivas: {
        Row: {
          calendar_event_id: string | null;
          cerrada_at: string | null;
          cerrada_por: string | null;
          cliente_id: string | null;
          consultora_id: string;
          created_at: string;
          created_by: string | null;
          descripcion: string;
          estado: string;
          evidencia_cierre: string | null;
          execution_id: string;
          fecha_compromiso: string;
          id: string;
          prioridad: string;
          respuesta_id: string | null;
          updated_at: string;
        };
        Insert: {
          calendar_event_id?: string | null;
          cerrada_at?: string | null;
          cerrada_por?: string | null;
          cliente_id?: string | null;
          consultora_id: string;
          created_at?: string;
          created_by?: string | null;
          descripcion: string;
          estado?: string;
          evidencia_cierre?: string | null;
          execution_id: string;
          fecha_compromiso: string;
          id?: string;
          prioridad?: string;
          respuesta_id?: string | null;
          updated_at?: string;
        };
        Update: {
          calendar_event_id?: string | null;
          cerrada_at?: string | null;
          cerrada_por?: string | null;
          cliente_id?: string | null;
          consultora_id?: string;
          created_at?: string;
          created_by?: string | null;
          descripcion?: string;
          estado?: string;
          evidencia_cierre?: string | null;
          execution_id?: string;
          fecha_compromiso?: string;
          id?: string;
          prioridad?: string;
          respuesta_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'acciones_correctivas_calendar_event_id_fkey';
            columns: ['calendar_event_id'];
            isOneToOne: false;
            referencedRelation: 'calendar_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'acciones_correctivas_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'acciones_correctivas_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'acciones_correctivas_execution_id_consultora_fkey';
            columns: ['execution_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'acciones_correctivas_execution_id_consultora_fkey';
            columns: ['execution_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions_heads';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'acciones_correctivas_execution_id_consultora_fkey';
            columns: ['execution_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions_vigentes';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'acciones_correctivas_respuesta_id_fkey';
            columns: ['respuesta_id'];
            isOneToOne: false;
            referencedRelation: 'execution_respuestas';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_user_id: string | null;
          after_data: Json | null;
          before_data: Json | null;
          consultora_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          ip: unknown;
          user_agent: string | null;
        };
        Insert: {
          action: string;
          actor_user_id?: string | null;
          after_data?: Json | null;
          before_data?: Json | null;
          consultora_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          ip?: unknown;
          user_agent?: string | null;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          after_data?: Json | null;
          before_data?: Json | null;
          consultora_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          ip?: unknown;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_log_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
        ];
      };
      billing_notifications_log: {
        Row: {
          consultora_id: string;
          created_at: string;
          id: string;
          ref_id: string | null;
          resend_email_id: string | null;
          sent_at: string;
          tipo: string;
        };
        Insert: {
          consultora_id: string;
          created_at?: string;
          id?: string;
          ref_id?: string | null;
          resend_email_id?: string | null;
          sent_at?: string;
          tipo: string;
        };
        Update: {
          consultora_id?: string;
          created_at?: string;
          id?: string;
          ref_id?: string | null;
          resend_email_id?: string | null;
          sent_at?: string;
          tipo?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'billing_notifications_log_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
        ];
      };
      calendar_event_reminders: {
        Row: {
          consultora_id: string;
          created_at: string;
          event_id: string;
          id: string;
          offset_days: number;
          scheduled_at: string;
          sent_at: string | null;
          status: string;
        };
        Insert: {
          consultora_id: string;
          created_at?: string;
          event_id: string;
          id?: string;
          offset_days: number;
          scheduled_at: string;
          sent_at?: string | null;
          status?: string;
        };
        Update: {
          consultora_id?: string;
          created_at?: string;
          event_id?: string;
          id?: string;
          offset_days?: number;
          scheduled_at?: string;
          sent_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'calendar_event_reminders_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calendar_event_reminders_event_id_consultora_fkey';
            columns: ['event_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'calendar_events';
            referencedColumns: ['id', 'consultora_id'];
          },
        ];
      };
      calendar_events: {
        Row: {
          completed_at: string | null;
          completed_by: string | null;
          consultora_id: string;
          created_at: string;
          created_by: string | null;
          descripcion: string | null;
          fecha_vencimiento: string;
          id: string;
          informe_id: string | null;
          metadata: Json | null;
          parent_event_id: string | null;
          recurrence_months: number | null;
          reminder_offsets_days: number[];
          status: string;
          tipo: string;
          titulo: string;
          updated_at: string;
        };
        Insert: {
          completed_at?: string | null;
          completed_by?: string | null;
          consultora_id: string;
          created_at?: string;
          created_by?: string | null;
          descripcion?: string | null;
          fecha_vencimiento: string;
          id?: string;
          informe_id?: string | null;
          metadata?: Json | null;
          parent_event_id?: string | null;
          recurrence_months?: number | null;
          reminder_offsets_days: number[];
          status?: string;
          tipo: string;
          titulo: string;
          updated_at?: string;
        };
        Update: {
          completed_at?: string | null;
          completed_by?: string | null;
          consultora_id?: string;
          created_at?: string;
          created_by?: string | null;
          descripcion?: string | null;
          fecha_vencimiento?: string;
          id?: string;
          informe_id?: string | null;
          metadata?: Json | null;
          parent_event_id?: string | null;
          recurrence_months?: number | null;
          reminder_offsets_days?: number[];
          status?: string;
          tipo?: string;
          titulo?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'calendar_events_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calendar_events_informe_id_fkey';
            columns: ['informe_id'];
            isOneToOne: false;
            referencedRelation: 'informes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'calendar_events_parent_event_id_fkey';
            columns: ['parent_event_id'];
            isOneToOne: false;
            referencedRelation: 'calendar_events';
            referencedColumns: ['id'];
          },
        ];
      };
      chat_conversaciones: {
        Row: {
          archived_at: string | null;
          consultora_id: string;
          created_at: string;
          id: string;
          titulo: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          archived_at?: string | null;
          consultora_id: string;
          created_at?: string;
          id?: string;
          titulo: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          archived_at?: string | null;
          consultora_id?: string;
          created_at?: string;
          id?: string;
          titulo?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'chat_conversaciones_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
        ];
      };
      chat_mensajes: {
        Row: {
          consultora_id: string;
          content: string;
          conversacion_id: string;
          created_at: string;
          id: string;
          role: string;
          seq: number;
          user_id: string;
        };
        Insert: {
          consultora_id: string;
          content: string;
          conversacion_id: string;
          created_at?: string;
          id?: string;
          role: string;
          seq?: never;
          user_id: string;
        };
        Update: {
          consultora_id?: string;
          content?: string;
          conversacion_id?: string;
          created_at?: string;
          id?: string;
          role?: string;
          seq?: never;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'chat_mensajes_conversacion_fkey';
            columns: ['conversacion_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'chat_conversaciones';
            referencedColumns: ['id', 'consultora_id'];
          },
        ];
      };
      checklist_executions: {
        Row: {
          anulacion: boolean;
          cerrada_at: string | null;
          cliente_id: string | null;
          consultora_id: string;
          corrige_id: string | null;
          created_at: string;
          created_by: string | null;
          cumplimiento_pct: number | null;
          establecimiento_cuit: string | null;
          establecimiento_domicilio: string | null;
          establecimiento_localidad: string | null;
          establecimiento_provincia: string | null;
          establecimiento_razon_social: string | null;
          estado: string;
          fecha_inspeccion: string | null;
          firma_pdf_hash: string | null;
          gps_lat: number | null;
          gps_lng: number | null;
          id: string;
          inspector_user_id: string | null;
          score_cumple: number | null;
          score_na: number | null;
          score_no_cumple: number | null;
          template_version_id: string;
          tiene_criticos_incumplidos: boolean | null;
          updated_at: string;
        };
        Insert: {
          anulacion?: boolean;
          cerrada_at?: string | null;
          cliente_id?: string | null;
          consultora_id: string;
          corrige_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          cumplimiento_pct?: number | null;
          establecimiento_cuit?: string | null;
          establecimiento_domicilio?: string | null;
          establecimiento_localidad?: string | null;
          establecimiento_provincia?: string | null;
          establecimiento_razon_social?: string | null;
          estado?: string;
          fecha_inspeccion?: string | null;
          firma_pdf_hash?: string | null;
          gps_lat?: number | null;
          gps_lng?: number | null;
          id?: string;
          inspector_user_id?: string | null;
          score_cumple?: number | null;
          score_na?: number | null;
          score_no_cumple?: number | null;
          template_version_id: string;
          tiene_criticos_incumplidos?: boolean | null;
          updated_at?: string;
        };
        Update: {
          anulacion?: boolean;
          cerrada_at?: string | null;
          cliente_id?: string | null;
          consultora_id?: string;
          corrige_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          cumplimiento_pct?: number | null;
          establecimiento_cuit?: string | null;
          establecimiento_domicilio?: string | null;
          establecimiento_localidad?: string | null;
          establecimiento_provincia?: string | null;
          establecimiento_razon_social?: string | null;
          estado?: string;
          fecha_inspeccion?: string | null;
          firma_pdf_hash?: string | null;
          gps_lat?: number | null;
          gps_lng?: number | null;
          id?: string;
          inspector_user_id?: string | null;
          score_cumple?: number | null;
          score_na?: number | null;
          score_no_cumple?: number | null;
          template_version_id?: string;
          tiene_criticos_incumplidos?: boolean | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'checklist_executions_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_executions_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_executions_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_executions_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions_heads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_executions_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions_vigentes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_executions_template_version_id_fkey';
            columns: ['template_version_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_template_versions';
            referencedColumns: ['id'];
          },
        ];
      };
      checklist_template_versions: {
        Row: {
          consultora_id: string | null;
          created_at: string;
          created_by: string | null;
          estado: string;
          id: string;
          published_at: string | null;
          published_by: string | null;
          template_id: string;
          updated_at: string;
          version_number: number;
        };
        Insert: {
          consultora_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          estado?: string;
          id?: string;
          published_at?: string | null;
          published_by?: string | null;
          template_id: string;
          updated_at?: string;
          version_number: number;
        };
        Update: {
          consultora_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          estado?: string;
          id?: string;
          published_at?: string | null;
          published_by?: string | null;
          template_id?: string;
          updated_at?: string;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'checklist_template_versions_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_template_versions_template_id_fkey';
            columns: ['template_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_templates';
            referencedColumns: ['id'];
          },
        ];
      };
      checklist_templates: {
        Row: {
          archived_at: string | null;
          consultora_id: string | null;
          created_at: string;
          created_by: string | null;
          descripcion: string | null;
          id: string;
          nombre: string;
          tipo_inspeccion: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          consultora_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          descripcion?: string | null;
          id?: string;
          nombre: string;
          tipo_inspeccion?: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          consultora_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          descripcion?: string | null;
          id?: string;
          nombre?: string;
          tipo_inspeccion?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'checklist_templates_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
        ];
      };
      cliente_puesto_agentes: {
        Row: {
          agente_id: string;
          asignado_at: string;
          asignado_por: string | null;
          cliente_id: string;
          consultora_id: string;
          puesto_id: string;
        };
        Insert: {
          agente_id: string;
          asignado_at?: string;
          asignado_por?: string | null;
          cliente_id: string;
          consultora_id: string;
          puesto_id: string;
        };
        Update: {
          agente_id?: string;
          asignado_at?: string;
          asignado_por?: string | null;
          cliente_id?: string;
          consultora_id?: string;
          puesto_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cliente_puesto_agentes_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cpa_agente_consultora_fkey';
            columns: ['agente_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'rar_agentes';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'cpa_cliente_consultora_fkey';
            columns: ['cliente_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'cpa_puesto_consultora_fkey';
            columns: ['puesto_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'puestos';
            referencedColumns: ['id', 'consultora_id'];
          },
        ];
      };
      clientes: {
        Row: {
          archived_at: string | null;
          art: string | null;
          consultora_id: string;
          contacto_email: string | null;
          contacto_nombre: string | null;
          contacto_telefono: string | null;
          created_at: string;
          created_by: string | null;
          cuit: string;
          domicilio: string | null;
          id: string;
          industria: string | null;
          localidad: string | null;
          nombre_fantasia: string | null;
          notas: string | null;
          provincia: string | null;
          razon_social: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          art?: string | null;
          consultora_id: string;
          contacto_email?: string | null;
          contacto_nombre?: string | null;
          contacto_telefono?: string | null;
          created_at?: string;
          created_by?: string | null;
          cuit: string;
          domicilio?: string | null;
          id?: string;
          industria?: string | null;
          localidad?: string | null;
          nombre_fantasia?: string | null;
          notas?: string | null;
          provincia?: string | null;
          razon_social: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          art?: string | null;
          consultora_id?: string;
          contacto_email?: string | null;
          contacto_nombre?: string | null;
          contacto_telefono?: string | null;
          created_at?: string;
          created_by?: string | null;
          cuit?: string;
          domicilio?: string | null;
          id?: string;
          industria?: string | null;
          localidad?: string | null;
          nombre_fantasia?: string | null;
          notas?: string | null;
          provincia?: string | null;
          razon_social?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'clientes_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
        ];
      };
      consultora_members: {
        Row: {
          consultora_id: string;
          created_at: string;
          id: string;
          role: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          consultora_id: string;
          created_at?: string;
          id?: string;
          role: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          consultora_id?: string;
          created_at?: string;
          id?: string;
          role?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'consultora_members_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
        ];
      };
      consultoras: {
        Row: {
          archived_at: string | null;
          auto_create_event_on_sign: boolean;
          created_at: string;
          cuit: string | null;
          id: string;
          logo_storage_path: string | null;
          name: string;
          onboarding_completado_at: string | null;
          plan: string;
          retencion_datos_hasta: string | null;
          slug: string;
          trial_hasta: string | null;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          auto_create_event_on_sign?: boolean;
          created_at?: string;
          cuit?: string | null;
          id?: string;
          logo_storage_path?: string | null;
          name: string;
          onboarding_completado_at?: string | null;
          plan?: string;
          retencion_datos_hasta?: string | null;
          slug: string;
          trial_hasta?: string | null;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          auto_create_event_on_sign?: boolean;
          created_at?: string;
          cuit?: string | null;
          id?: string;
          logo_storage_path?: string | null;
          name?: string;
          onboarding_completado_at?: string | null;
          plan?: string;
          retencion_datos_hasta?: string | null;
          slug?: string;
          trial_hasta?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      empleados: {
        Row: {
          apellido: string;
          archived_at: string | null;
          cliente_id: string;
          consultora_id: string;
          created_at: string;
          created_by: string | null;
          cuil: string | null;
          dni: string;
          email: string | null;
          fecha_ingreso: string | null;
          fecha_nacimiento: string | null;
          id: string;
          nombre: string;
          notas: string | null;
          telefono: string | null;
          updated_at: string;
        };
        Insert: {
          apellido: string;
          archived_at?: string | null;
          cliente_id: string;
          consultora_id: string;
          created_at?: string;
          created_by?: string | null;
          cuil?: string | null;
          dni: string;
          email?: string | null;
          fecha_ingreso?: string | null;
          fecha_nacimiento?: string | null;
          id?: string;
          nombre: string;
          notas?: string | null;
          telefono?: string | null;
          updated_at?: string;
        };
        Update: {
          apellido?: string;
          archived_at?: string | null;
          cliente_id?: string;
          consultora_id?: string;
          created_at?: string;
          created_by?: string | null;
          cuil?: string | null;
          dni?: string;
          email?: string | null;
          fecha_ingreso?: string | null;
          fecha_nacimiento?: string | null;
          id?: string;
          nombre?: string;
          notas?: string | null;
          telefono?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'empleados_cliente_id_consultora_fkey';
            columns: ['cliente_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'empleados_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
        ];
      };
      empleados_puestos: {
        Row: {
          asignado_at: string;
          asignado_por: string | null;
          consultora_id: string;
          empleado_id: string;
          puesto_id: string;
        };
        Insert: {
          asignado_at?: string;
          asignado_por?: string | null;
          consultora_id: string;
          empleado_id: string;
          puesto_id: string;
        };
        Update: {
          asignado_at?: string;
          asignado_por?: string | null;
          consultora_id?: string;
          empleado_id?: string;
          puesto_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'empleados_puestos_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'empleados_puestos_empleado_id_consultora_fkey';
            columns: ['empleado_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'empleados';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'empleados_puestos_puesto_id_consultora_fkey';
            columns: ['puesto_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'puestos';
            referencedColumns: ['id', 'consultora_id'];
          },
        ];
      };
      epp_categorias: {
        Row: {
          archived_at: string | null;
          consultora_id: string;
          created_at: string;
          created_by: string | null;
          descripcion: string | null;
          id: string;
          nombre: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          consultora_id: string;
          created_at?: string;
          created_by?: string | null;
          descripcion?: string | null;
          id?: string;
          nombre: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          consultora_id?: string;
          created_at?: string;
          created_by?: string | null;
          descripcion?: string | null;
          id?: string;
          nombre?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'epp_categorias_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
        ];
      };
      epp_entrega_items: {
        Row: {
          cantidad: number;
          consultora_id: string;
          created_at: string;
          entrega_id: string;
          id: string;
          item_id: string;
          marca_entregada: string | null;
          modelo_entregado: string | null;
          motivo_entrega: Database['public']['Enums']['motivo_entrega_epp'];
          numero_serie: string | null;
          vida_util_meses_override: number | null;
        };
        Insert: {
          cantidad?: number;
          consultora_id: string;
          created_at?: string;
          entrega_id: string;
          id?: string;
          item_id: string;
          marca_entregada?: string | null;
          modelo_entregado?: string | null;
          motivo_entrega?: Database['public']['Enums']['motivo_entrega_epp'];
          numero_serie?: string | null;
          vida_util_meses_override?: number | null;
        };
        Update: {
          cantidad?: number;
          consultora_id?: string;
          created_at?: string;
          entrega_id?: string;
          id?: string;
          item_id?: string;
          marca_entregada?: string | null;
          modelo_entregado?: string | null;
          motivo_entrega?: Database['public']['Enums']['motivo_entrega_epp'];
          numero_serie?: string | null;
          vida_util_meses_override?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'epp_entrega_items_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'epp_entrega_items_entrega_id_consultora_fkey';
            columns: ['entrega_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'epp_entregas';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'epp_entrega_items_item_id_consultora_fkey';
            columns: ['item_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'epp_items';
            referencedColumns: ['id', 'consultora_id'];
          },
        ];
      };
      epp_entregas: {
        Row: {
          cliente_id: string;
          consultora_id: string;
          created_at: string;
          created_by: string | null;
          empleado_id: string;
          fecha_entrega: string;
          firma_storage_path: string | null;
          firmado_at: string | null;
          id: string;
          observaciones: string | null;
        };
        Insert: {
          cliente_id: string;
          consultora_id: string;
          created_at?: string;
          created_by?: string | null;
          empleado_id: string;
          fecha_entrega?: string;
          firma_storage_path?: string | null;
          firmado_at?: string | null;
          id?: string;
          observaciones?: string | null;
        };
        Update: {
          cliente_id?: string;
          consultora_id?: string;
          created_at?: string;
          created_by?: string | null;
          empleado_id?: string;
          fecha_entrega?: string;
          firma_storage_path?: string | null;
          firmado_at?: string | null;
          id?: string;
          observaciones?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'epp_entregas_cliente_id_consultora_fkey';
            columns: ['cliente_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'epp_entregas_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'epp_entregas_empleado_id_consultora_fkey';
            columns: ['empleado_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'empleados';
            referencedColumns: ['id', 'consultora_id'];
          },
        ];
      };
      epp_items: {
        Row: {
          archived_at: string | null;
          categoria_id: string;
          consultora_id: string;
          created_at: string;
          created_by: string | null;
          es_descartable: boolean;
          id: string;
          marca_default: string | null;
          modelo_default: string | null;
          nombre: string;
          normativa: string | null;
          notas: string | null;
          requiere_numero_serie: boolean;
          updated_at: string;
          vida_util_meses: number;
        };
        Insert: {
          archived_at?: string | null;
          categoria_id: string;
          consultora_id: string;
          created_at?: string;
          created_by?: string | null;
          es_descartable?: boolean;
          id?: string;
          marca_default?: string | null;
          modelo_default?: string | null;
          nombre: string;
          normativa?: string | null;
          notas?: string | null;
          requiere_numero_serie?: boolean;
          updated_at?: string;
          vida_util_meses?: number;
        };
        Update: {
          archived_at?: string | null;
          categoria_id?: string;
          consultora_id?: string;
          created_at?: string;
          created_by?: string | null;
          es_descartable?: boolean;
          id?: string;
          marca_default?: string | null;
          modelo_default?: string | null;
          nombre?: string;
          normativa?: string | null;
          notas?: string | null;
          requiere_numero_serie?: boolean;
          updated_at?: string;
          vida_util_meses?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'epp_items_categoria_id_consultora_fkey';
            columns: ['categoria_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'epp_categorias';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'epp_items_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
        ];
      };
      epp_planificaciones: {
        Row: {
          calendar_event_id: string | null;
          consultora_id: string;
          created_at: string;
          empleado_id: string;
          estado: Database['public']['Enums']['estado_planificacion_epp'];
          fecha_proxima_entrega: string;
          frecuencia_meses: number;
          generado_de_entrega_id: string;
          id: string;
          item_id: string;
          updated_at: string;
        };
        Insert: {
          calendar_event_id?: string | null;
          consultora_id: string;
          created_at?: string;
          empleado_id: string;
          estado?: Database['public']['Enums']['estado_planificacion_epp'];
          fecha_proxima_entrega: string;
          frecuencia_meses: number;
          generado_de_entrega_id: string;
          id?: string;
          item_id: string;
          updated_at?: string;
        };
        Update: {
          calendar_event_id?: string | null;
          consultora_id?: string;
          created_at?: string;
          empleado_id?: string;
          estado?: Database['public']['Enums']['estado_planificacion_epp'];
          fecha_proxima_entrega?: string;
          frecuencia_meses?: number;
          generado_de_entrega_id?: string;
          id?: string;
          item_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'epp_planificaciones_calendar_event_id_fkey';
            columns: ['calendar_event_id'];
            isOneToOne: false;
            referencedRelation: 'calendar_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'epp_planificaciones_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'epp_planificaciones_empleado_id_consultora_fkey';
            columns: ['empleado_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'empleados';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'epp_planificaciones_generado_de_entrega_id_consultora_fkey';
            columns: ['generado_de_entrega_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'epp_entregas';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'epp_planificaciones_item_id_consultora_fkey';
            columns: ['item_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'epp_items';
            referencedColumns: ['id', 'consultora_id'];
          },
        ];
      };
      execution_adjuntos: {
        Row: {
          consultora_id: string;
          created_at: string;
          created_by: string | null;
          execution_id: string;
          id: string;
          mime_type: string | null;
          respuesta_id: string | null;
          size_bytes: number | null;
          storage_path: string;
        };
        Insert: {
          consultora_id: string;
          created_at?: string;
          created_by?: string | null;
          execution_id: string;
          id?: string;
          mime_type?: string | null;
          respuesta_id?: string | null;
          size_bytes?: number | null;
          storage_path: string;
        };
        Update: {
          consultora_id?: string;
          created_at?: string;
          created_by?: string | null;
          execution_id?: string;
          id?: string;
          mime_type?: string | null;
          respuesta_id?: string | null;
          size_bytes?: number | null;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'execution_adjuntos_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'execution_adjuntos_execution_id_consultora_fkey';
            columns: ['execution_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'execution_adjuntos_execution_id_consultora_fkey';
            columns: ['execution_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions_heads';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'execution_adjuntos_execution_id_consultora_fkey';
            columns: ['execution_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions_vigentes';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'execution_adjuntos_respuesta_id_fkey';
            columns: ['respuesta_id'];
            isOneToOne: false;
            referencedRelation: 'execution_respuestas';
            referencedColumns: ['id'];
          },
        ];
      };
      execution_firmas: {
        Row: {
          consultora_id: string;
          created_at: string;
          execution_id: string;
          firma_storage_path: string;
          firmado_at: string;
          firmante_matricula: string | null;
          firmante_nombre: string | null;
          id: string;
          rol: string;
        };
        Insert: {
          consultora_id: string;
          created_at?: string;
          execution_id: string;
          firma_storage_path: string;
          firmado_at?: string;
          firmante_matricula?: string | null;
          firmante_nombre?: string | null;
          id?: string;
          rol: string;
        };
        Update: {
          consultora_id?: string;
          created_at?: string;
          execution_id?: string;
          firma_storage_path?: string;
          firmado_at?: string;
          firmante_matricula?: string | null;
          firmante_nombre?: string | null;
          id?: string;
          rol?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'execution_firmas_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'execution_firmas_execution_id_consultora_fkey';
            columns: ['execution_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'execution_firmas_execution_id_consultora_fkey';
            columns: ['execution_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions_heads';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'execution_firmas_execution_id_consultora_fkey';
            columns: ['execution_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions_vigentes';
            referencedColumns: ['id', 'consultora_id'];
          },
        ];
      };
      execution_respuestas: {
        Row: {
          consultora_id: string;
          created_at: string;
          execution_id: string;
          fecha_regularizacion: string | null;
          id: string;
          observacion: string | null;
          template_item_id: string;
          updated_at: string;
          valor: string | null;
          valor_numerico: number | null;
        };
        Insert: {
          consultora_id: string;
          created_at?: string;
          execution_id: string;
          fecha_regularizacion?: string | null;
          id?: string;
          observacion?: string | null;
          template_item_id: string;
          updated_at?: string;
          valor?: string | null;
          valor_numerico?: number | null;
        };
        Update: {
          consultora_id?: string;
          created_at?: string;
          execution_id?: string;
          fecha_regularizacion?: string | null;
          id?: string;
          observacion?: string | null;
          template_item_id?: string;
          updated_at?: string;
          valor?: string | null;
          valor_numerico?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'execution_respuestas_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'execution_respuestas_execution_id_consultora_fkey';
            columns: ['execution_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'execution_respuestas_execution_id_consultora_fkey';
            columns: ['execution_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions_heads';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'execution_respuestas_execution_id_consultora_fkey';
            columns: ['execution_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions_vigentes';
            referencedColumns: ['id', 'consultora_id'];
          },
          {
            foreignKeyName: 'execution_respuestas_template_item_id_fkey';
            columns: ['template_item_id'];
            isOneToOne: false;
            referencedRelation: 'template_items';
            referencedColumns: ['id'];
          },
        ];
      };
      facturas: {
        Row: {
          consultora_id: string;
          created_at: string;
          estado: Database['public']['Enums']['estado_factura'];
          id: string;
          moneda: string;
          monto_centavos: number;
          mp_payment_id: string;
          pagada_en: string | null;
          razon_falla: string | null;
          recibo_url: string | null;
          suscripcion_id: string;
        };
        Insert: {
          consultora_id: string;
          created_at?: string;
          estado?: Database['public']['Enums']['estado_factura'];
          id?: string;
          moneda?: string;
          monto_centavos: number;
          mp_payment_id: string;
          pagada_en?: string | null;
          razon_falla?: string | null;
          recibo_url?: string | null;
          suscripcion_id: string;
        };
        Update: {
          consultora_id?: string;
          created_at?: string;
          estado?: Database['public']['Enums']['estado_factura'];
          id?: string;
          moneda?: string;
          monto_centavos?: number;
          mp_payment_id?: string;
          pagada_en?: string | null;
          razon_falla?: string | null;
          recibo_url?: string | null;
          suscripcion_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'facturas_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'facturas_suscripcion_id_fkey';
            columns: ['suscripcion_id'];
            isOneToOne: false;
            referencedRelation: 'suscripciones';
            referencedColumns: ['id'];
          },
        ];
      };
      incidentes: {
        Row: {
          accion_inmediata: string | null;
          anulacion: boolean;
          causa_raiz: string | null;
          cliente_id: string | null;
          consultora_id: string;
          corrige_id: string | null;
          created_at: string;
          created_by: string | null;
          descripcion: string;
          dias_perdidos: number | null;
          empleado_id: string | null;
          fecha: string;
          gravedad: Database['public']['Enums']['gravedad_incidente'] | null;
          hora: string | null;
          id: string;
          informe_id: string | null;
          lugar_especifico: string | null;
          tipo: Database['public']['Enums']['tipo_incidente'];
        };
        Insert: {
          accion_inmediata?: string | null;
          anulacion?: boolean;
          causa_raiz?: string | null;
          cliente_id?: string | null;
          consultora_id: string;
          corrige_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          descripcion: string;
          dias_perdidos?: number | null;
          empleado_id?: string | null;
          fecha: string;
          gravedad?: Database['public']['Enums']['gravedad_incidente'] | null;
          hora?: string | null;
          id?: string;
          informe_id?: string | null;
          lugar_especifico?: string | null;
          tipo: Database['public']['Enums']['tipo_incidente'];
        };
        Update: {
          accion_inmediata?: string | null;
          anulacion?: boolean;
          causa_raiz?: string | null;
          cliente_id?: string | null;
          consultora_id?: string;
          corrige_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          descripcion?: string;
          dias_perdidos?: number | null;
          empleado_id?: string | null;
          fecha?: string;
          gravedad?: Database['public']['Enums']['gravedad_incidente'] | null;
          hora?: string | null;
          id?: string;
          informe_id?: string | null;
          lugar_especifico?: string | null;
          tipo?: Database['public']['Enums']['tipo_incidente'];
        };
        Relationships: [
          {
            foreignKeyName: 'incidentes_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'incidentes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'incidentes_heads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'incidentes_vigentes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_empleado_id_fkey';
            columns: ['empleado_id'];
            isOneToOne: false;
            referencedRelation: 'empleados';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_informe_id_fkey';
            columns: ['informe_id'];
            isOneToOne: false;
            referencedRelation: 'informes';
            referencedColumns: ['id'];
          },
        ];
      };
      informe_attachments: {
        Row: {
          caption: string | null;
          consultora_id: string;
          created_at: string;
          filename: string;
          id: string;
          informe_id: string;
          kind: string;
          mime_type: string;
          position: number;
          size_bytes: number;
          storage_path: string;
          updated_at: string;
          uploaded_by: string | null;
        };
        Insert: {
          caption?: string | null;
          consultora_id: string;
          created_at?: string;
          filename: string;
          id?: string;
          informe_id: string;
          kind: string;
          mime_type: string;
          position?: number;
          size_bytes: number;
          storage_path: string;
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Update: {
          caption?: string | null;
          consultora_id?: string;
          created_at?: string;
          filename?: string;
          id?: string;
          informe_id?: string;
          kind?: string;
          mime_type?: string;
          position?: number;
          size_bytes?: number;
          storage_path?: string;
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'informe_attachments_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'informe_attachments_informe_id_consultora_fkey';
            columns: ['informe_id', 'consultora_id'];
            isOneToOne: false;
            referencedRelation: 'informes';
            referencedColumns: ['id', 'consultora_id'];
          },
        ];
      };
      informe_metadata: {
        Row: {
          created_at: string;
          data: Json;
          informe_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          data?: Json;
          informe_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          data?: Json;
          informe_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'informe_metadata_informe_id_fkey';
            columns: ['informe_id'];
            isOneToOne: true;
            referencedRelation: 'informes';
            referencedColumns: ['id'];
          },
        ];
      };
      informe_plantillas: {
        Row: {
          archived_at: string | null;
          config: Json;
          consultora_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          nombre: string;
          tipo: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          config: Json;
          consultora_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          nombre: string;
          tipo: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          config?: Json;
          consultora_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          nombre?: string;
          tipo?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'informe_plantillas_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
        ];
      };
      informes: {
        Row: {
          cliente_id: string | null;
          consultora_id: string;
          contenido: string | null;
          contenido_borrador: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          status: string;
          tipo: string;
          titulo: string;
          updated_at: string;
        };
        Insert: {
          cliente_id?: string | null;
          consultora_id: string;
          contenido?: string | null;
          contenido_borrador?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          status?: string;
          tipo: string;
          titulo: string;
          updated_at?: string;
        };
        Update: {
          cliente_id?: string | null;
          consultora_id?: string;
          contenido?: string | null;
          contenido_borrador?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          status?: string;
          tipo?: string;
          titulo?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'informes_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'informes_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_channel_prefs: {
        Row: {
          channel: string;
          created_at: string;
          enabled: boolean;
          id: string;
          muted_until: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          channel: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          muted_until?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          channel?: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          muted_until?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      notification_digest_log: {
        Row: {
          channel: string;
          consultora_id: string;
          created_at: string;
          id: string;
          periodo_iso: string;
          resend_email_id: string | null;
          sent_at: string;
          tipo: string;
        };
        Insert: {
          channel: string;
          consultora_id: string;
          created_at?: string;
          id?: string;
          periodo_iso: string;
          resend_email_id?: string | null;
          sent_at?: string;
          tipo: string;
        };
        Update: {
          channel?: string;
          consultora_id?: string;
          created_at?: string;
          id?: string;
          periodo_iso?: string;
          resend_email_id?: string | null;
          sent_at?: string;
          tipo?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_digest_log_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_log: {
        Row: {
          channel: string;
          consultora_id: string;
          error_code: string | null;
          error_detail: string | null;
          event_id: string | null;
          id: string;
          provider_message_id: string | null;
          recipient_user_id: string | null;
          reminder_id: string | null;
          sent_at: string;
          status: string;
        };
        Insert: {
          channel: string;
          consultora_id: string;
          error_code?: string | null;
          error_detail?: string | null;
          event_id?: string | null;
          id?: string;
          provider_message_id?: string | null;
          recipient_user_id?: string | null;
          reminder_id?: string | null;
          sent_at?: string;
          status: string;
        };
        Update: {
          channel?: string;
          consultora_id?: string;
          error_code?: string | null;
          error_detail?: string | null;
          event_id?: string | null;
          id?: string;
          provider_message_id?: string | null;
          recipient_user_id?: string | null;
          reminder_id?: string | null;
          sent_at?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_log_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notification_log_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'calendar_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notification_log_reminder_id_fkey';
            columns: ['reminder_id'];
            isOneToOne: false;
            referencedRelation: 'calendar_event_reminders';
            referencedColumns: ['id'];
          },
        ];
      };
      puestos: {
        Row: {
          archived_at: string | null;
          consultora_id: string;
          created_at: string;
          created_by: string | null;
          descripcion: string | null;
          id: string;
          nombre: string;
          riesgos_asociados: string[] | null;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          consultora_id: string;
          created_at?: string;
          created_by?: string | null;
          descripcion?: string | null;
          id?: string;
          nombre: string;
          riesgos_asociados?: string[] | null;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          consultora_id?: string;
          created_at?: string;
          created_by?: string | null;
          descripcion?: string | null;
          id?: string;
          nombre?: string;
          riesgos_asociados?: string[] | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'puestos_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          auth_key: string;
          created_at: string;
          endpoint: string;
          id: string;
          last_seen_at: string | null;
          p256dh_key: string;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          auth_key: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          last_seen_at?: string | null;
          p256dh_key: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          auth_key?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          last_seen_at?: string | null;
          p256dh_key?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      rar_agentes: {
        Row: {
          agente_tipo: Database['public']['Enums']['agente_riesgo_tipo'];
          archived_at: string | null;
          cas: string | null;
          codigo: string;
          consultora_id: string;
          created_at: string;
          created_by: string | null;
          descripcion: string | null;
          enfermedad_asociada: string | null;
          id: string;
          nombre: string;
          updated_at: string;
        };
        Insert: {
          agente_tipo: Database['public']['Enums']['agente_riesgo_tipo'];
          archived_at?: string | null;
          cas?: string | null;
          codigo: string;
          consultora_id: string;
          created_at?: string;
          created_by?: string | null;
          descripcion?: string | null;
          enfermedad_asociada?: string | null;
          id?: string;
          nombre: string;
          updated_at?: string;
        };
        Update: {
          agente_tipo?: Database['public']['Enums']['agente_riesgo_tipo'];
          archived_at?: string | null;
          cas?: string | null;
          codigo?: string;
          consultora_id?: string;
          created_at?: string;
          created_by?: string | null;
          descripcion?: string | null;
          enfermedad_asociada?: string | null;
          id?: string;
          nombre?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rar_agentes_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
        ];
      };
      suscripciones: {
        Row: {
          cancelada_en: string | null;
          cancelar_en: string | null;
          consultora_id: string;
          created_at: string;
          estado: Database['public']['Enums']['estado_suscripcion'];
          id: string;
          init_point: string | null;
          mp_subscription_id: string | null;
          periodo_fin: string;
          periodo_inicio: string;
          plan_codigo: Database['public']['Enums']['plan_codigo'];
          updated_at: string;
        };
        Insert: {
          cancelada_en?: string | null;
          cancelar_en?: string | null;
          consultora_id: string;
          created_at?: string;
          estado?: Database['public']['Enums']['estado_suscripcion'];
          id?: string;
          init_point?: string | null;
          mp_subscription_id?: string | null;
          periodo_fin: string;
          periodo_inicio: string;
          plan_codigo: Database['public']['Enums']['plan_codigo'];
          updated_at?: string;
        };
        Update: {
          cancelada_en?: string | null;
          cancelar_en?: string | null;
          consultora_id?: string;
          created_at?: string;
          estado?: Database['public']['Enums']['estado_suscripcion'];
          id?: string;
          init_point?: string | null;
          mp_subscription_id?: string | null;
          periodo_fin?: string;
          periodo_inicio?: string;
          plan_codigo?: Database['public']['Enums']['plan_codigo'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'suscripciones_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
        ];
      };
      telegram_subscriptions: {
        Row: {
          blocked_count: number;
          created_at: string;
          id: string;
          link_code: string | null;
          link_code_expires_at: string | null;
          linked_at: string | null;
          telegram_chat_id: number | null;
          telegram_username: string | null;
          unlinked_at: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          blocked_count?: number;
          created_at?: string;
          id?: string;
          link_code?: string | null;
          link_code_expires_at?: string | null;
          linked_at?: string | null;
          telegram_chat_id?: number | null;
          telegram_username?: string | null;
          unlinked_at?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          blocked_count?: number;
          created_at?: string;
          id?: string;
          link_code?: string | null;
          link_code_expires_at?: string | null;
          linked_at?: string | null;
          telegram_chat_id?: number | null;
          telegram_username?: string | null;
          unlinked_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      template_items: {
        Row: {
          config: Json | null;
          consultora_id: string | null;
          created_at: string;
          es_critico: boolean;
          es_requerido: boolean;
          id: string;
          orden: number;
          referencia_normativa: string | null;
          response_type: string;
          section_id: string;
          texto: string;
          version_id: string;
        };
        Insert: {
          config?: Json | null;
          consultora_id?: string | null;
          created_at?: string;
          es_critico?: boolean;
          es_requerido?: boolean;
          id?: string;
          orden: number;
          referencia_normativa?: string | null;
          response_type?: string;
          section_id: string;
          texto: string;
          version_id: string;
        };
        Update: {
          config?: Json | null;
          consultora_id?: string | null;
          created_at?: string;
          es_critico?: boolean;
          es_requerido?: boolean;
          id?: string;
          orden?: number;
          referencia_normativa?: string | null;
          response_type?: string;
          section_id?: string;
          texto?: string;
          version_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'template_items_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'template_items_section_id_fkey';
            columns: ['section_id'];
            isOneToOne: false;
            referencedRelation: 'template_sections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'template_items_version_id_fkey';
            columns: ['version_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_template_versions';
            referencedColumns: ['id'];
          },
        ];
      };
      template_sections: {
        Row: {
          consultora_id: string | null;
          created_at: string;
          descripcion: string | null;
          id: string;
          orden: number;
          titulo: string;
          version_id: string;
        };
        Insert: {
          consultora_id?: string | null;
          created_at?: string;
          descripcion?: string | null;
          id?: string;
          orden: number;
          titulo: string;
          version_id: string;
        };
        Update: {
          consultora_id?: string | null;
          created_at?: string;
          descripcion?: string | null;
          id?: string;
          orden?: number;
          titulo?: string;
          version_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'template_sections_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'template_sections_version_id_fkey';
            columns: ['version_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_template_versions';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      checklist_executions_heads: {
        Row: {
          anulacion: boolean | null;
          cerrada_at: string | null;
          cliente_id: string | null;
          consultora_id: string | null;
          corrige_id: string | null;
          created_at: string | null;
          created_by: string | null;
          cumplimiento_pct: number | null;
          establecimiento_cuit: string | null;
          establecimiento_domicilio: string | null;
          establecimiento_localidad: string | null;
          establecimiento_provincia: string | null;
          establecimiento_razon_social: string | null;
          estado: string | null;
          fecha_inspeccion: string | null;
          firma_pdf_hash: string | null;
          gps_lat: number | null;
          gps_lng: number | null;
          id: string | null;
          inspector_user_id: string | null;
          score_cumple: number | null;
          score_na: number | null;
          score_no_cumple: number | null;
          template_version_id: string | null;
          tiene_criticos_incumplidos: boolean | null;
          updated_at: string | null;
        };
        Insert: {
          anulacion?: boolean | null;
          cerrada_at?: string | null;
          cliente_id?: string | null;
          consultora_id?: string | null;
          corrige_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          cumplimiento_pct?: number | null;
          establecimiento_cuit?: string | null;
          establecimiento_domicilio?: string | null;
          establecimiento_localidad?: string | null;
          establecimiento_provincia?: string | null;
          establecimiento_razon_social?: string | null;
          estado?: string | null;
          fecha_inspeccion?: string | null;
          firma_pdf_hash?: string | null;
          gps_lat?: number | null;
          gps_lng?: number | null;
          id?: string | null;
          inspector_user_id?: string | null;
          score_cumple?: number | null;
          score_na?: number | null;
          score_no_cumple?: number | null;
          template_version_id?: string | null;
          tiene_criticos_incumplidos?: boolean | null;
          updated_at?: string | null;
        };
        Update: {
          anulacion?: boolean | null;
          cerrada_at?: string | null;
          cliente_id?: string | null;
          consultora_id?: string | null;
          corrige_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          cumplimiento_pct?: number | null;
          establecimiento_cuit?: string | null;
          establecimiento_domicilio?: string | null;
          establecimiento_localidad?: string | null;
          establecimiento_provincia?: string | null;
          establecimiento_razon_social?: string | null;
          estado?: string | null;
          fecha_inspeccion?: string | null;
          firma_pdf_hash?: string | null;
          gps_lat?: number | null;
          gps_lng?: number | null;
          id?: string | null;
          inspector_user_id?: string | null;
          score_cumple?: number | null;
          score_na?: number | null;
          score_no_cumple?: number | null;
          template_version_id?: string | null;
          tiene_criticos_incumplidos?: boolean | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'checklist_executions_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_executions_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_executions_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_executions_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions_heads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_executions_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions_vigentes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_executions_template_version_id_fkey';
            columns: ['template_version_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_template_versions';
            referencedColumns: ['id'];
          },
        ];
      };
      checklist_executions_vigentes: {
        Row: {
          anulacion: boolean | null;
          cerrada_at: string | null;
          cliente_id: string | null;
          consultora_id: string | null;
          corrige_id: string | null;
          created_at: string | null;
          created_by: string | null;
          cumplimiento_pct: number | null;
          establecimiento_cuit: string | null;
          establecimiento_domicilio: string | null;
          establecimiento_localidad: string | null;
          establecimiento_provincia: string | null;
          establecimiento_razon_social: string | null;
          estado: string | null;
          fecha_inspeccion: string | null;
          firma_pdf_hash: string | null;
          gps_lat: number | null;
          gps_lng: number | null;
          id: string | null;
          inspector_user_id: string | null;
          score_cumple: number | null;
          score_na: number | null;
          score_no_cumple: number | null;
          template_version_id: string | null;
          tiene_criticos_incumplidos: boolean | null;
          updated_at: string | null;
        };
        Insert: {
          anulacion?: boolean | null;
          cerrada_at?: string | null;
          cliente_id?: string | null;
          consultora_id?: string | null;
          corrige_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          cumplimiento_pct?: number | null;
          establecimiento_cuit?: string | null;
          establecimiento_domicilio?: string | null;
          establecimiento_localidad?: string | null;
          establecimiento_provincia?: string | null;
          establecimiento_razon_social?: string | null;
          estado?: string | null;
          fecha_inspeccion?: string | null;
          firma_pdf_hash?: string | null;
          gps_lat?: number | null;
          gps_lng?: number | null;
          id?: string | null;
          inspector_user_id?: string | null;
          score_cumple?: number | null;
          score_na?: number | null;
          score_no_cumple?: number | null;
          template_version_id?: string | null;
          tiene_criticos_incumplidos?: boolean | null;
          updated_at?: string | null;
        };
        Update: {
          anulacion?: boolean | null;
          cerrada_at?: string | null;
          cliente_id?: string | null;
          consultora_id?: string | null;
          corrige_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          cumplimiento_pct?: number | null;
          establecimiento_cuit?: string | null;
          establecimiento_domicilio?: string | null;
          establecimiento_localidad?: string | null;
          establecimiento_provincia?: string | null;
          establecimiento_razon_social?: string | null;
          estado?: string | null;
          fecha_inspeccion?: string | null;
          firma_pdf_hash?: string | null;
          gps_lat?: number | null;
          gps_lng?: number | null;
          id?: string | null;
          inspector_user_id?: string | null;
          score_cumple?: number | null;
          score_na?: number | null;
          score_no_cumple?: number | null;
          template_version_id?: string | null;
          tiene_criticos_incumplidos?: boolean | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'checklist_executions_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_executions_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_executions_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_executions_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions_heads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_executions_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_executions_vigentes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'checklist_executions_template_version_id_fkey';
            columns: ['template_version_id'];
            isOneToOne: false;
            referencedRelation: 'checklist_template_versions';
            referencedColumns: ['id'];
          },
        ];
      };
      incidentes_heads: {
        Row: {
          accion_inmediata: string | null;
          anulacion: boolean | null;
          causa_raiz: string | null;
          cliente_id: string | null;
          consultora_id: string | null;
          corrige_id: string | null;
          created_at: string | null;
          created_by: string | null;
          descripcion: string | null;
          dias_perdidos: number | null;
          empleado_id: string | null;
          fecha: string | null;
          gravedad: Database['public']['Enums']['gravedad_incidente'] | null;
          hora: string | null;
          id: string | null;
          informe_id: string | null;
          lugar_especifico: string | null;
          tipo: Database['public']['Enums']['tipo_incidente'] | null;
        };
        Insert: {
          accion_inmediata?: string | null;
          anulacion?: boolean | null;
          causa_raiz?: string | null;
          cliente_id?: string | null;
          consultora_id?: string | null;
          corrige_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          descripcion?: string | null;
          dias_perdidos?: number | null;
          empleado_id?: string | null;
          fecha?: string | null;
          gravedad?: Database['public']['Enums']['gravedad_incidente'] | null;
          hora?: string | null;
          id?: string | null;
          informe_id?: string | null;
          lugar_especifico?: string | null;
          tipo?: Database['public']['Enums']['tipo_incidente'] | null;
        };
        Update: {
          accion_inmediata?: string | null;
          anulacion?: boolean | null;
          causa_raiz?: string | null;
          cliente_id?: string | null;
          consultora_id?: string | null;
          corrige_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          descripcion?: string | null;
          dias_perdidos?: number | null;
          empleado_id?: string | null;
          fecha?: string | null;
          gravedad?: Database['public']['Enums']['gravedad_incidente'] | null;
          hora?: string | null;
          id?: string | null;
          informe_id?: string | null;
          lugar_especifico?: string | null;
          tipo?: Database['public']['Enums']['tipo_incidente'] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'incidentes_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'incidentes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'incidentes_heads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'incidentes_vigentes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_empleado_id_fkey';
            columns: ['empleado_id'];
            isOneToOne: false;
            referencedRelation: 'empleados';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_informe_id_fkey';
            columns: ['informe_id'];
            isOneToOne: false;
            referencedRelation: 'informes';
            referencedColumns: ['id'];
          },
        ];
      };
      incidentes_vigentes: {
        Row: {
          accion_inmediata: string | null;
          anulacion: boolean | null;
          causa_raiz: string | null;
          cliente_id: string | null;
          consultora_id: string | null;
          corrige_id: string | null;
          created_at: string | null;
          created_by: string | null;
          descripcion: string | null;
          dias_perdidos: number | null;
          empleado_id: string | null;
          fecha: string | null;
          gravedad: Database['public']['Enums']['gravedad_incidente'] | null;
          hora: string | null;
          id: string | null;
          informe_id: string | null;
          lugar_especifico: string | null;
          tipo: Database['public']['Enums']['tipo_incidente'] | null;
        };
        Insert: {
          accion_inmediata?: string | null;
          anulacion?: boolean | null;
          causa_raiz?: string | null;
          cliente_id?: string | null;
          consultora_id?: string | null;
          corrige_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          descripcion?: string | null;
          dias_perdidos?: number | null;
          empleado_id?: string | null;
          fecha?: string | null;
          gravedad?: Database['public']['Enums']['gravedad_incidente'] | null;
          hora?: string | null;
          id?: string | null;
          informe_id?: string | null;
          lugar_especifico?: string | null;
          tipo?: Database['public']['Enums']['tipo_incidente'] | null;
        };
        Update: {
          accion_inmediata?: string | null;
          anulacion?: boolean | null;
          causa_raiz?: string | null;
          cliente_id?: string | null;
          consultora_id?: string | null;
          corrige_id?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          descripcion?: string | null;
          dias_perdidos?: number | null;
          empleado_id?: string | null;
          fecha?: string | null;
          gravedad?: Database['public']['Enums']['gravedad_incidente'] | null;
          hora?: string | null;
          id?: string | null;
          informe_id?: string | null;
          lugar_especifico?: string | null;
          tipo?: Database['public']['Enums']['tipo_incidente'] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'incidentes_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_consultora_id_fkey';
            columns: ['consultora_id'];
            isOneToOne: false;
            referencedRelation: 'consultoras';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'incidentes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'incidentes_heads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_corrige_id_fkey';
            columns: ['corrige_id'];
            isOneToOne: false;
            referencedRelation: 'incidentes_vigentes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_empleado_id_fkey';
            columns: ['empleado_id'];
            isOneToOne: false;
            referencedRelation: 'empleados';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'incidentes_informe_id_fkey';
            columns: ['informe_id'];
            isOneToOne: false;
            referencedRelation: 'informes';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      clone_system_template: {
        Args: {
          p_consultora_id: string;
          p_nombre: string;
          p_system_template_id: string;
        };
        Returns: Json;
      };
      clone_template_to_draft: {
        Args: { p_template_id: string };
        Returns: string;
      };
      clone_version_structure: {
        Args: {
          p_consultora: string;
          p_from_version: string;
          p_to_version: string;
        };
        Returns: undefined;
      };
      create_consultora_and_owner: {
        Args: { p_name: string; p_user_id: string };
        Returns: {
          consultora_id: string;
          slug: string;
        }[];
      };
      create_template_with_draft: {
        Args: {
          p_consultora_id: string;
          p_descripcion: string;
          p_nombre: string;
          p_tipo_inspeccion: string;
        };
        Returns: Json;
      };
      current_consultora_id: { Args: never; Returns: string };
      custom_access_token_hook: { Args: { event: Json }; Returns: Json };
      gen_acciones_calendar_for: {
        Args: { p_execution_id: string };
        Returns: undefined;
      };
      gen_epp_planificaciones_y_calendar_for: {
        Args: { p_entrega_id: string };
        Returns: undefined;
      };
      is_member_of_consultora: {
        Args: { p_consultora_id: string };
        Returns: boolean;
      };
      is_owner_of_consultora: {
        Args: { p_consultora_id: string };
        Returns: boolean;
      };
      link_informe_to_incidente: {
        Args: { p_incidente_id: string; p_informe_id: string };
        Returns: undefined;
      };
      my_consultora_ids: { Args: never; Returns: string[] };
      process_dunning_recovery: { Args: never; Returns: undefined };
      process_epp_weekly_summary: { Args: never; Returns: undefined };
      process_pending_billing_dunning: { Args: never; Returns: undefined };
      process_pending_reminders: {
        Args: never;
        Returns: {
          claimed_id: string;
          dispatched: boolean;
        }[];
      };
      process_subscription_churn: { Args: never; Returns: number };
      reorder_template_items: {
        Args: { p_ordered_ids: string[]; p_section_id: string };
        Returns: undefined;
      };
      reorder_template_sections: {
        Args: { p_ordered_ids: string[]; p_version_id: string };
        Returns: undefined;
      };
      role_on_consultora: { Args: { p_consultora_id: string }; Returns: string };
      semaforo_clientes: {
        Args: { p_hoy?: string };
        Returns: {
          cliente_id: string;
          estado: string;
          fecha_proxima: string;
          proximos_count: number;
          vencidos_count: number;
        }[];
      };
      set_cron_vault_secret: {
        Args: { new_value: string; secret_name: string };
        Returns: undefined;
      };
      unaccent: { Args: { '': string }; Returns: string };
    };
    Enums: {
      agente_riesgo_tipo: 'fisico' | 'quimico' | 'biologico' | 'ergonomico';
      estado_factura: 'pendiente' | 'pagada' | 'fallida' | 'reembolsada';
      estado_planificacion_epp: 'activa' | 'cumplida' | 'cancelada';
      estado_suscripcion:
        | 'trial'
        | 'pendiente_autorizacion'
        | 'activa'
        | 'morosa'
        | 'cancelada'
        | 'expirada';
      gravedad_incidente: 'leve' | 'grave' | 'mortal';
      motivo_entrega_epp:
        | 'inicial'
        | 'renovacion'
        | 'reposicion_rotura'
        | 'reposicion_perdida'
        | 'rotacion';
      plan_codigo: 'pro_mensual';
      tipo_incidente: 'casi_accidente' | 'accidente';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      agente_riesgo_tipo: ['fisico', 'quimico', 'biologico', 'ergonomico'],
      estado_factura: ['pendiente', 'pagada', 'fallida', 'reembolsada'],
      estado_planificacion_epp: ['activa', 'cumplida', 'cancelada'],
      estado_suscripcion: [
        'trial',
        'pendiente_autorizacion',
        'activa',
        'morosa',
        'cancelada',
        'expirada',
      ],
      gravedad_incidente: ['leve', 'grave', 'mortal'],
      motivo_entrega_epp: [
        'inicial',
        'renovacion',
        'reposicion_rotura',
        'reposicion_perdida',
        'rotacion',
      ],
      plan_codigo: ['pro_mensual'],
      tipo_incidente: ['casi_accidente', 'accidente'],
    },
  },
} as const;
