#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FilaPro - Toledo Scale Relay Client (Python 3)
Este script deve ser executado no servidor local de cada filial (loja).
Ele se conecta ao painel central FilaPro para baixar as configurações da loja
e encaminha as chamadas das balanças locais em tempo real.
"""

import socket
import urllib.request
import urllib.parse
import urllib.error
import json
import re
import sys
import time
import os

SETTINGS_FILE = "relay-settings.json"

# Variáveis globais de configuração (carregadas do arquivo JSON ou via assistente)
CENTRAL_SERVER_BASE_URL = ""
STORE_SLUG = ""
LISTEN_PORT = 9050

# Cache interno de mapeamentos de balanças (atualizado dinamicamente pelo servidor central)
SCALE_MAPPINGS = {}
LAST_CONFIG_LOAD_TIME = 0
CONFIG_RELOAD_INTERVAL = 300  # Recarrega configurações a cada 5 minutos

def show_banner():
    print("======================================================================")
    print("      FilaPro - Assistente de Configuração do Toledo Relay (Agente)")
    print("======================================================================")

def setup_wizard():
    """
    Assistente interativo no terminal para configurar a URL do servidor central
    e selecionar a loja correspondente. Salva as configurações em um arquivo JSON.
    """
    global CENTRAL_SERVER_BASE_URL, STORE_SLUG, LISTEN_PORT
    show_banner()
    
    # 1. Solicita a URL do Servidor Central
    while True:
        url_input = input("\nDigite a URL base do Servidor Central do FilaPro\n(Padrão: http://localhost:3000): ").strip()
        if not url_input:
            url_input = "http://localhost:3000"
            
        # Normaliza a URL (adiciona protocolo se não informado)
        if not url_input.startswith("http://") and not url_input.startswith("https://"):
            url_input = "http://" + url_input
            
        # Remove barra final
        if url_input.endswith("/"):
            url_input = url_input[:-1]
            
        print(f"Testando conexão com o Servidor Central em: {url_input}/api/config ...")
        
        try:
            req = urllib.request.Request(f"{url_input}/api/config", method="GET")
            with urllib.request.urlopen(req, timeout=5) as response:
                res_body = response.read().decode('utf-8')
                config_data = json.loads(res_body)
                stores = config_data.get("stores", {})
                break
        except Exception as e:
            print(f"\n[Erro] Não foi possível conectar ao servidor central: {str(e)}")
            print("Certifique-se de que o servidor central do FilaPro está rodando e a URL está correta.")
            
    # 2. Exibe as lojas cadastradas na central
    if not stores:
        print("\n[Erro] Nenhuma loja cadastrada no servidor central do FilaPro.")
        print("Cadastre pelo menos uma filial no painel administrativo antes de rodar o agente.")
        sys.exit(1)
        
    print("\nLojas (empresas) disponíveis no servidor central:")
    store_list = []
    for idx, (slug, info) in enumerate(stores.items(), 1):
        name = info.get("name", slug)
        store_list.append((slug, name))
        print(f"[{idx}] {name} ({slug})")
        
    # 3. Seleciona a loja
    while True:
        try:
            choice = input(f"\nSelecione o número correspondente a esta loja (1 a {len(store_list)}): ").strip()
            choice_idx = int(choice) - 1
            if 0 <= choice_idx < len(store_list):
                selected_slug, selected_name = store_list[choice_idx]
                break
            else:
                print(f"Opção inválida. Digite um número de 1 a {len(store_list)}.")
        except ValueError:
            print("Entrada inválida. Por favor, digite um número.")
            
    # 4. Salva as configurações
    CENTRAL_SERVER_BASE_URL = url_input
    STORE_SLUG = selected_slug
    
    settings = {
        "CENTRAL_SERVER_BASE_URL": CENTRAL_SERVER_BASE_URL,
        "STORE_SLUG": STORE_SLUG,
        "LISTEN_PORT": LISTEN_PORT
    }
    
    try:
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings, f, indent=2, ensure_ascii=False)
        print(f"\n[Sucesso] Configuração salva com sucesso no arquivo '{SETTINGS_FILE}'!")
        print(f"Loja configurada: {selected_name} ({selected_slug})")
        print("======================================================================\n")
    except Exception as e:
        print(f"\n[Erro] Não foi possível salvar o arquivo '{SETTINGS_FILE}': {str(e)}")

def load_local_settings():
    """
    Carrega as configurações locais do arquivo JSON. Se não existir, chama o assistente.
    """
    global CENTRAL_SERVER_BASE_URL, STORE_SLUG, LISTEN_PORT
    
    # Se o argumento --reset ou -r for passado, apaga a configuração anterior
    if len(sys.argv) > 1 and sys.argv[1] in ["--reset", "-r"]:
        if os.path.exists(SETTINGS_FILE):
            os.remove(SETTINGS_FILE)
            print(f"[Config] Arquivo '{SETTINGS_FILE}' removido para reconfiguração.")
            
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                settings = json.load(f)
                CENTRAL_SERVER_BASE_URL = settings.get("CENTRAL_SERVER_BASE_URL", "")
                STORE_SLUG = settings.get("STORE_SLUG", "")
                LISTEN_PORT = settings.get("LISTEN_PORT", 9050)
                
            if CENTRAL_SERVER_BASE_URL and STORE_SLUG:
                print(f"[Config] Configurações locais carregadas de '{SETTINGS_FILE}'")
                print(f"   - Servidor Central: {CENTRAL_SERVER_BASE_URL}")
                print(f"   - Filial (Loja): {STORE_SLUG}")
                print(f"   - Porta de Escuta: {LISTEN_PORT}")
                return
        except Exception as e:
            print(f"[Config] Erro ao ler '{SETTINGS_FILE}': {str(e)}. Iniciando assistente...")
            
    setup_wizard()

def load_remote_config():
    """
    Busca as configurações de mapeamento de balanças para esta filial
    diretamente do servidor central do FilaPro.
    """
    global SCALE_MAPPINGS, LAST_CONFIG_LOAD_TIME
    url = f"{CENTRAL_SERVER_BASE_URL}/api/toledo/relay-config?store={urllib.parse.quote(STORE_SLUG)}"
    print(f"[Relay] Buscando configurações de balanças em: {url}")
    
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            res_body = response.read().decode('utf-8')
            config_data = json.loads(res_body)
            SCALE_MAPPINGS = config_data.get("mappings", {})
            LAST_CONFIG_LOAD_TIME = time.time()
            
            print(f"[Relay] Configurações carregadas com sucesso! Balanças cadastradas nesta loja:")
            if not SCALE_MAPPINGS:
                print("   -> Nenhuma balança cadastrada para esta filial no painel administrativo.")
            for ip, info in SCALE_MAPPINGS.items():
                print(f"   - {ip} -> Setor: {info['sector']} | Guichê: {info['guiche']}")
            return True
    except urllib.error.URLError as e:
        print(f"[Relay] ERRO ao obter configurações do servidor central: {e.reason}")
    except Exception as e:
        print(f"[Relay] ERRO ao carregar configurações: {str(e)}")
    return False

def parse_ticket_payload(data):
    """
    Filtra pacotes binários (heartbeats) e extrai o texto do ticket de pacotes válidos.
    Retorna (is_binary, text)
    """
    if not data:
        return False, ""

    # Se o pacote começar com STX (0x02), verifica integridade até o ETX (0x03)
    if data[0] == 0x02:
        try:
            etx_index = data.index(0x03)
        except ValueError:
            return True, ""  # Tem STX mas não tem ETX (incompleto/binário)
        
        # Verifica se há algum byte não-imprimível entre STX e ETX
        for i in range(1, etx_index):
            b = data[i]
            if b < 32 or b > 126:
                return True, ""
        
        # Decodifica conteúdo
        text = data[1:etx_index].decode('ascii', errors='ignore').strip()
        return False, text
    else:
        # Se não começar com STX, verifica se todos os bytes são ASCII legíveis (32-126)
        for b in data:
            if b < 32 or b > 126:
                return True, ""
        
        text = data.decode('ascii', errors='ignore').strip()
        return False, text

def forward_call_to_central(store, sector, number, guiche):
    """
    Envia a chamada de senha para o FilaPro central via HTTP POST
    """
    url = f"{CENTRAL_SERVER_BASE_URL}/api/toledo/call"
    payload = {
        "store": store,
        "sector": sector,
        "number": number,
        "guiche": guiche
    }
    
    headers = {
        "Content-Type": "application/json"
    }
    
    data_json = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data_json, headers=headers, method="POST")
    
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            res_body = response.read().decode('utf-8')
            print(f"[HTTP] Sucesso ao encaminhar: {res_body}")
    except urllib.error.URLError as e:
        print(f"[HTTP] ERRO ao conectar no servidor central: {e.reason}")
    except Exception as e:
        print(f"[HTTP] ERRO inesperado ao encaminhar dados: {str(e)}")

def start_server():
    global SCALE_MAPPINGS
    
    # Carrega configurações locais/assistente
    load_local_settings()
    
    # Carrega as configurações remotas do FilaPro Central
    load_remote_config()
    
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    
    try:
        server.bind(('0.0.0.0', LISTEN_PORT))
        server.listen(5)
        print("======================================================================")
        print(f"FilaPro Toledo Relay rodando no servidor local da loja '{STORE_SLUG}'")
        print(f"Ouvindo balanças locais na porta TCP {LISTEN_PORT}...")
        print("   Nota: Para reconfigurar o agente local, execute com o parâmetro: -r")
        print("======================================================================")
    except Exception as e:
        print(f"[Relay] Erro ao abrir a porta {LISTEN_PORT}: {str(e)}")
        sys.exit(1)
        
    while True:
        try:
            conn, addr = server.accept()
            remote_ip = addr[0]
            
            # Lê os bytes enviados pela balança
            data = conn.recv(1024)
            if not data:
                conn.close()
                continue
                
            hex_data = data.hex().upper()
            is_binary, text_payload = parse_ticket_payload(data)
            
            if is_binary:
                # Silenciosamente ignora pacotes binários (heartbeats)
                conn.close()
                continue
                
            print(f"\n[Toledo] Balança conectada: {remote_ip}")
            print(f"[Toledo] Texto recebido: '{text_payload}' | Hex: {hex_data}")
            
            # Recarrega configurações se passou do tempo de recarga
            if time.time() - LAST_CONFIG_LOAD_TIME > CONFIG_RELOAD_INTERVAL:
                print("[Relay] Tempo limite de cache atingido. Recarregando configurações do servidor...")
                load_remote_config()
            
            # Se o IP da balança não estiver no mapeamento, faz uma busca ativa para ver se houve novo cadastro
            if remote_ip not in SCALE_MAPPINGS:
                print(f"[Relay] IP {remote_ip} não mapeado no cache. Buscando atualizações no servidor central...")
                load_remote_config()
                
            mapping = SCALE_MAPPINGS.get(remote_ip)
            if not mapping:
                print(f"[Toledo] Alerta: Conexão de {remote_ip} rejeitada pois o IP não está cadastrado no painel central.")
                conn.close()
                continue
                
            sector = mapping["sector"]
            guiche = mapping["guiche"]
            
            # Busca números no texto
            match = re.search(r'\d+', text_payload)
            ticket_number = None
            if match:
                ticket_number = int(match.group(0))
                print(f"[Relay] Balança chamando senha específica: {ticket_number} | Guichê: {guiche}")
            else:
                print(f"[Relay] Balança chamando PRÓXIMA da fila | Guichê: {guiche}")
                
            # Encaminha a chamada para o FilaPro central
            forward_call_to_central(
                store=STORE_SLUG,
                sector=sector,
                number=ticket_number,
                guiche=guiche
            )
            
            conn.close()
            
        except KeyboardInterrupt:
            print("\n[Relay] Encerrando o serviço...")
            break
        except Exception as e:
            print(f"[Relay] Erro no loop de escuta: {str(e)}")
            time.sleep(1)
            
    server.close()

if __name__ == "__main__":
    start_server()
