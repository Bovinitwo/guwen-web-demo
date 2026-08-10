from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ARK_API_KEY: str = ""
    ARK_BASE_URL: str = "https://ark.cn-beijing.volces.com/api/v3"
    ARK_MODEL_ENDPOINT: str = ""

    ARK_KB_BASE_URL: str = "https://api-knowledgebase.mlp.cn-beijing.volces.com"
    ARK_KB_COLLECTION_NAME: str = ""
    ARK_KB_RESOURCE_ID: str = ""
    ARK_KB_PROJECT: str = "default"
    VIKING_API_KEY: str = ""

    # TOS 对象存储 (presign 直传)
    TOS_ENDPOINT: str = ""
    TOS_REGION: str = "cn-beijing"
    TOS_BUCKET: str = ""
    TOS_ACCESS_KEY_ID: str = ""
    TOS_SECRET_ACCESS_KEY: str = ""

    PORT: int = 8000


settings = Settings()
