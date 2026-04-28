#!/usr/bin/env bash
#
# Driver pra bubblewrap update/build em CI. Bubblewrap é interativo por
# design — usa `expect` pra casar prompts pelo texto e responder com os
# valores corretos.
#
# Uso:
#   bubblewrap-driver.sh update [args adicionais...]
#   bubblewrap-driver.sh build  [args adicionais...]
#
# Variáveis de ambiente esperadas:
#   KEYSTORE_PASSWORD — senha do keystore (.keystore inteiro)
#   KEY_PASSWORD     — senha da key (alias específico)
#
# Exit codes:
#   0   sucesso
#   1   variáveis de ambiente faltando
#   2   timeout do expect
#   N   exit code propagado do bubblewrap
#
# Por que não pipe simples:
#   `printf '%s\n%s\n' pwd1 pwd2 | bubblewrap` falha porque bubblewrap
#   faz prompts de confirmação ANTES dos prompts de senha. As senhas
#   acabam sendo enviadas pra prompts errados, e quando chega o prompt
#   real de senha, recebe string vazia → "Minimum length is 6, got 0"
#   → bubblewrap re-prompta infinitamente → OOM (exit 134).
#
#   `yes "" | bubblewrap` pelo mesmo motivo: aceita defaults pra confirma-
#   ções, mas defaulta pra "" em prompts de senha → mesmo loop infinito.
#
#   expect casa pelo TEXTO do prompt e envia a resposta certa pra cada
#   um, independente da ordem. exp_continue mantém escutando outros
#   prompts no mesmo spawn.

set -euo pipefail

if [ -z "${KEYSTORE_PASSWORD:-}" ] || [ -z "${KEY_PASSWORD:-}" ]; then
  echo "::error::KEYSTORE_PASSWORD e KEY_PASSWORD devem estar setados" >&2
  exit 1
fi

if [ $# -lt 1 ]; then
  echo "Usage: $0 <update|build> [bubblewrap args...]" >&2
  exit 1
fi

CMD="$1"
shift

case "$CMD" in
  update|build) ;;
  *)
    echo "::error::Comando inválido: $CMD (esperado: update|build)" >&2
    exit 1
    ;;
esac

# Passa os args extras pro expect via env (escapar via array é instável
# com expect, env var é mais previsível).
export BW_CMD="$CMD"
export BW_ARGS="$*"

expect <<'EOF'
set timeout 1200
set keystore_pwd $env(KEYSTORE_PASSWORD)
set key_pwd      $env(KEY_PASSWORD)
set bw_cmd       $env(BW_CMD)
set bw_args      $env(BW_ARGS)

# Constrói lista de argumentos pra bubblewrap. spawn quer args separados,
# então split por espaço — ok porque nossos args não contêm espaços.
set args [list $bw_cmd]
foreach arg [split $bw_args] {
  if {$arg ne ""} { lappend args $arg }
}

eval spawn bubblewrap $args

expect {
  # Senha do keystore (arquivo .keystore como um todo)
  -re "(?i)password for the key store" {
    send -- "$keystore_pwd\r"
    exp_continue
  }
  # Senha da key (alias específico)
  -re "(?i)password for the key:" {
    send -- "$key_pwd\r"
    exp_continue
  }
  # Variação que algumas versões do bubblewrap usam
  -re "(?i)enter passwords for the keystore.*alias" {
    # Esse é um prompt informativo seguido de prompts individuais —
    # não responde nada, só continua escutando.
    exp_continue
  }
  # Prompts yes/no — aceita default (tecla Enter)
  -re "\\(Y/n\\)|\\(y/N\\)" {
    send -- "\r"
    exp_continue
  }
  # Prompt genérico de input — pode aceitar default mas se o prompt
  # exigir non-empty (ex: "Minimum length is 1"), envia string sentinela.
  # Bubblewrap update/build não devem ter campos required além das
  # senhas, então default é seguro pra confirmações de versionName etc.
  -re "Minimum length is" {
    # Aqui significa que enviamos algo vazio ou curto demais. Acontece
    # se um prompt não-mapeado ficou esperando. Loga e prossegue —
    # se for senha real, deveria ter casado em um dos -re acima.
    send_user "::warning::expect: prompt rejeitou input vazio. Verificar regex no driver.\n"
    exp_continue
  }
  timeout {
    send_user "::error::expect timeout (1200s) — bubblewrap travado em prompt não-mapeado\n"
    exit 2
  }
  eof {
    catch wait result
    set exit_status [lindex $result 3]
    exit $exit_status
  }
}
EOF
